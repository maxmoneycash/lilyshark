import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { retryMessage, sendText } from '../mesh/radio';
import { getSnapshot, mutate } from '../mesh/store';
import {
  connectDeviceLink,
  disconnectDeviceLink,
  getDeviceLinkState,
  sendDeviceLine,
  sendMeshCoreAdvert,
  sendMeshtasticDirectMessage,
  sendMeshtasticNodeInfo,
  sendMeshtasticPosition,
  sendMeshtasticText,
  sendNodeRumour,
  sendRawInjection,
} from './deviceLink';

const COMMAND = 'LSK TX meshtastic text hello';
const OK = 'LSK OK {"proto":"meshtastic","kind":"text"}';

test('USB transmission confirmations stay attached to their command', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let onWrite: (line: string) => Promise<void>;
  let writes: string[];
  const reply = (line: string) => controller.enqueue(new TextEncoder().encode(`${line}\n`));

  t.beforeEach(async () => {
    writes = [];
    onWrite = async () => {};
    const port = {
      readable: new ReadableStream<Uint8Array>({ start: (c) => { controller = c; } }),
      writable: new WritableStream<Uint8Array>({
        async write(bytes) {
          const line = new TextDecoder().decode(bytes).trim();
          writes.push(line);
          await onWrite(line);
        },
      }),
      getInfo: () => ({ usbVendorId: 0x303a }),
      open: async () => {},
      close: async () => {},
      setSignals: async () => reply('LSK ID {"app":"lilyshark","fw":"test"}'),
    };
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { serial: { getPorts: async () => [port] } },
    });
    await connectDeviceLink();
    assert.equal(getDeviceLinkState().status, 'linked');
  });
  t.afterEach(async () => {
    await disconnectDeviceLink();
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
  });

  await t.test('accepts a reply that arrives before write() resolves', async () => {
    onWrite = async (line) => {
      if (line === COMMAND) {
        reply(OK);
        await setImmediate();
      }
    };
    await sendDeviceLine(COMMAND);
    assert.deepEqual(writes, [COMMAND]);
  });

  await t.test('rejects a concurrent command without writing it or replacing the waiter', async () => {
    const first = sendDeviceLine(COMMAND);
    await assert.rejects(sendDeviceLine('LSK TX meshtastic text second'), /waiting for the deck/);
    await assert.rejects(sendDeviceLine('LSK SWEEP start'), /waiting for the deck/);
    assert.deepEqual(writes, [COMMAND]);
    reply(OK);
    await first;
  });

  await t.test('ignores unrelated success replies and preserves the radio refusal', async () => {
    let settled = false;
    const first = sendDeviceLine(COMMAND);
    const rejected = assert.rejects(first, /duty-cycle/);
    void first.then(() => { settled = true; }, () => { settled = true; });
    reply('LSK OK {"kind":"sweep","state":"started"}');
    reply('LSK OK {"proto":"meshcore","kind":"advert"}');
    await setImmediate();
    assert.equal(settled, false);
    reply('LSK ERR {"proto":"meshtastic","reason":"duty-cycle"}');
    await rejected;
  });

  await t.test('rejects immediately when the port write fails', async () => {
    onWrite = async () => { throw new Error('USB write failed'); };
    await assert.rejects(sendDeviceLine(COMMAND), /USB write failed/);
  });

  await t.test('disconnect rejects the pending message and releases the waiter', async () => {
    const pending = assert.rejects(sendDeviceLine(COMMAND), /disconnected before confirming TX/);
    await disconnectDeviceLink();
    await pending;
  });

  await t.test('legacy telemetry borrows validity only from its exact capture sequence', async () => {
    reply('LSK F {"src":42,"seq":7,"hex":"01","pf":96,"dir":1,"rssi_x10":-1180,"snr_x10":0}');
    reply('LSK T {"frames":7,"rx":1,"rssi_x10":-1180,"snr_x10":0}');
    await setImmediate();
    assert.equal(getDeviceLinkState().telemetry?.presentFields, 96);
    assert.equal(getDeviceLinkState().telemetry?.direction, 1);
    reply('LSK T {"frames":8,"rx":1,"rssi_x10":0,"snr_x10":0}');
    await setImmediate();
    assert.equal(getDeviceLinkState().telemetry?.presentFields, undefined);
    assert.equal(getDeviceLinkState().telemetry?.direction, undefined);
    reply('LSK T {"frames":7,"latest_pf":0,"latest_dir":2,"rssi_x10":0,"snr_x10":0}');
    await setImmediate();
    assert.equal(getDeviceLinkState().telemetry?.presentFields, 0, 'explicit telemetry wins over a stored frame');
    assert.equal(getDeviceLinkState().telemetry?.direction, 2);
  });

  await t.test('a failed USB message retries through the same link and chat row', async () => {
    mutate((s) => { s.messages = []; });
    onWrite = async (line) => {
      if (line === COMMAND) reply('LSK ERR {"proto":"meshtastic","reason":"duty cycle limit reached"}');
    };
    await assert.rejects(sendText('hello', 'ch:0'), /duty cycle limit/);
    const failed = getSnapshot().messages[0];
    assert.equal(failed.state, 'failed');
    assert.equal(failed.failureReason, 'duty cycle limit reached');
    onWrite = async (line) => { if (line === COMMAND) reply(OK); };
    await retryMessage(failed);
    const messages = getSnapshot().messages;
    assert.equal(messages.length, 1, 'retry must preserve the existing row');
    assert.equal(messages[0].id, failed.id);
    assert.equal(messages[0].ts, failed.ts);
    assert.equal(messages[0].state, 'sent');
    assert.equal(messages[0].failureReason, undefined);
    assert.deepEqual(writes, [COMMAND, COMMAND]);
  });

  await t.test('sendMeshCoreAdvert emits correct advert command and handles reach variants', async () => {
    onWrite = async (line) => {
      if (line === 'LSK TX meshcore advert') {
        reply('LSK OK {"proto":"meshcore","kind":"advert","reach":"zero-hop"}');
      } else if (line === 'LSK TX meshcore advert flood') {
        reply('LSK OK {"proto":"meshcore","kind":"advert","reach":"flood"}');
      }
    };
    await sendMeshCoreAdvert();
    await sendMeshCoreAdvert('flood');
    assert.deepEqual(writes, ['LSK TX meshcore advert', 'LSK TX meshcore advert flood']);
  });

  await t.test('sendMeshtasticPosition and sendMeshtasticNodeInfo confirm over USB', async () => {
    onWrite = async (line) => {
      if (line === 'LSK TX meshtastic position') {
        reply('LSK OK {"proto":"meshtastic","kind":"position"}');
      } else if (line === 'LSK TX meshtastic nodeinfo') {
        reply('LSK OK {"proto":"meshtastic","kind":"nodeinfo"}');
      }
    };
    await sendMeshtasticPosition();
    await sendMeshtasticNodeInfo();
    assert.deepEqual(writes, ['LSK TX meshtastic position', 'LSK TX meshtastic nodeinfo']);
  });

  await t.test('sendMeshtasticText validates non-empty text and emits command', async () => {
    onWrite = async (line) => {
      if (line === 'LSK TX meshtastic text broadcast_hello') {
        reply('LSK OK {"proto":"meshtastic","kind":"text"}');
      }
    };
    await assert.rejects(sendMeshtasticText(''), /cannot be empty/);
    await sendMeshtasticText('broadcast_hello');
    assert.deepEqual(writes, ['LSK TX meshtastic text broadcast_hello']);
  });

  await t.test('sendMeshtasticDirectMessage validates destination and formats command', async () => {
    onWrite = async (line) => {
      if (line === 'LSK TX meshtastic dm 0000002a ping') {
        reply('LSK OK {"proto":"meshtastic","kind":"dm"}');
      }
    };
    await assert.rejects(sendMeshtasticDirectMessage(42, ''), /cannot be empty/);
    await assert.rejects(sendMeshtasticDirectMessage('xyz', 'hello'), /invalid destination node ID/);
    await sendMeshtasticDirectMessage(42, 'ping');
    assert.deepEqual(writes, ['LSK TX meshtastic dm 0000002a ping']);
  });

  await t.test('sendRawInjection validates hex bounds and awaits inj confirmation', async () => {
    onWrite = async (line) => {
      if (line === 'LSK INJ deadbeef') {
        reply('LSK OK {"kind":"inj"}');
      }
    };
    await assert.rejects(sendRawInjection(''), /cannot be empty/);
    await assert.rejects(sendRawInjection('123'), /invalid hex payload/);
    await assert.rejects(sendRawInjection('zz'), /invalid hex payload/);
    await assert.rejects(sendRawInjection('aa'.repeat(256)), /exceeds 255-byte limit/);
    await sendRawInjection('DEADBEEF');
    assert.deepEqual(writes, ['LSK INJ deadbeef']);
  });

  await t.test('sendNodeRumour validates node ID and formats coordinates to 1e7 integers', async () => {
    onWrite = async (line) => {
      if (line === 'LSK NODE 0000002a 377749000 -1224194000 San_Francisco') {
        reply('LSK OK {"kind":"node"}');
      }
    };
    await assert.rejects(sendNodeRumour('invalid', 0, 0, 'Test'), /invalid node ID/);
    await sendNodeRumour(42, 37.7749, -122.4194, 'San Francisco');
    assert.deepEqual(writes, ['LSK NODE 0000002a 377749000 -1224194000 San_Francisco']);
  });
});
