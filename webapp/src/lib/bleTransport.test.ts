import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type BluetoothDeviceLike,
  bleLinkAvailability,
  createBleTransport,
  DEFAULT_BLE_CHUNK_BYTES,
  type GattCharacteristicLike,
  type GattServiceLike,
  grantedLskBleDevices,
  isWebBluetoothAvailable,
  LSK_BLE_FIRMWARE_STATUS,
  LSK_BLE_NAME_PREFIX,
  LSK_BLE_RX_CHARACTERISTIC_UUID,
  LSK_BLE_SERVICE_UUID,
  LSK_BLE_TX_CHARACTERISTIC_UUID,
  requestLskBleDevice,
} from './bleTransport';
import type { TransportSink } from './deviceTransport';
import { parseLskLine } from './deviceLink';

/* ── fake GATT, the way deviceLink's serial tests fake a port ─────────────── */

class FakeCharacteristic implements GattCharacteristicLike {
  value: DataView | null = null;
  readonly writes: Uint8Array[] = [];
  notifying = false;
  private listeners: Array<(event: Event) => void> = [];

  constructor(readonly uuid: string) {}

  async writeValueWithoutResponse(value: Uint8Array): Promise<void> {
    this.writes.push(new Uint8Array(value));
  }

  async startNotifications(): Promise<unknown> {
    this.notifying = true;
    return this;
  }

  async stopNotifications(): Promise<unknown> {
    this.notifying = false;
    return this;
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    if (type === 'characteristicvaluechanged') this.listeners.push(listener);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    if (type !== 'characteristicvaluechanged') return;
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  /** The device pushing one MTU-sized notification at the browser. */
  notify(chunk: Uint8Array): void {
    const copy = new Uint8Array(chunk);
    const view = new DataView(copy.buffer);
    this.value = view;
    const event = { target: { value: view } } as unknown as Event;
    for (const listener of [...this.listeners]) listener(event);
  }

  /** Everything the browser has written, rejoined as the device would. */
  writtenText(): string {
    const total = this.writes.reduce((n, w) => n + w.length, 0);
    const joined = new Uint8Array(total);
    let at = 0;
    for (const w of this.writes) {
      joined.set(w, at);
      at += w.length;
    }
    return new TextDecoder().decode(joined);
  }
}

class FakeDevice implements BluetoothDeviceLike {
  readonly name = 'Lilyshark T-Deck';
  readonly rx = new FakeCharacteristic(LSK_BLE_RX_CHARACTERISTIC_UUID);
  readonly tx = new FakeCharacteristic(LSK_BLE_TX_CHARACTERISTIC_UUID);
  connects = 0;
  disconnects = 0;
  connected = false;
  /** Set to drop the LSK service, the way pre-BLE firmware would. */
  serveLsk = true;
  private listeners: Array<(event: Event) => void> = [];

  readonly gatt = {
    connected: false,
    connect: async (): Promise<unknown> => {
      this.connects += 1;
      this.connected = true;
      return this.gatt;
    },
    disconnect: (): void => {
      if (!this.connected) return;
      this.disconnects += 1;
      this.connected = false;
    },
    getPrimaryService: async (uuid: string): Promise<GattServiceLike> => {
      if (!this.serveLsk || uuid !== LSK_BLE_SERVICE_UUID) {
        throw new Error(`No Services matching UUID ${uuid} found`);
      }
      return {
        getCharacteristic: async (charUuid: string): Promise<GattCharacteristicLike> => {
          if (charUuid === LSK_BLE_TX_CHARACTERISTIC_UUID) return this.tx;
          if (charUuid === LSK_BLE_RX_CHARACTERISTIC_UUID) return this.rx;
          throw new Error(`No Characteristic matching UUID ${charUuid} found`);
        },
      };
    },
  };

  addEventListener(type: string, listener: (event: Event) => void): void {
    if (type === 'gattserverdisconnected') this.listeners.push(listener);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    if (type !== 'gattserverdisconnected') return;
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  /** The radio walking out of range, or rebooting. */
  dropLink(): void {
    this.connected = false;
    for (const listener of [...this.listeners]) listener({} as Event);
  }
}

const collect = (): TransportSink & { lines: string[]; drops: number } => {
  const sink = {
    lines: [] as string[],
    drops: 0,
    onLine(line: string) {
      sink.lines.push(line);
    },
    onDrop() {
      sink.drops += 1;
    },
  };
  return sink;
};

const chunksOf = (text: string, size: number): Uint8Array[] => {
  const encoded = new TextEncoder().encode(text);
  const out: Uint8Array[] = [];
  for (let at = 0; at < encoded.length; at += size) out.push(encoded.slice(at, at + size));
  return out;
};

/* ── honest availability ──────────────────────────────────────────────────── */

test('a browser without Web Bluetooth is told exactly that', () => {
  assert.equal(isWebBluetoothAvailable({}), false);
  const availability = bleLinkAvailability({}, 'advertised');
  assert.equal(availability.browserSupported, false);
  assert.equal(availability.usable, false);
  assert.match(availability.detail, /Web Bluetooth/);
});

test('a capable browser with no BLE firmware is told the firmware is missing', () => {
  const availability = bleLinkAvailability({ bluetooth: {} }, 'absent');
  assert.equal(availability.browserSupported, true);
  assert.equal(availability.firmwareSupported, false);
  assert.equal(availability.usable, false);
  assert.match(availability.detail, /firmware/i);
  assert.match(availability.detail, /USB only/);
});

test('the option only becomes usable once firmware advertises the service', () => {
  const availability = bleLinkAvailability({ bluetooth: {} }, 'advertised');
  assert.equal(availability.usable, true);
});

test('shipped firmware does not advertise LSK over BLE yet', () => {
  // This constant is the single place the claim lives. Flipping it without
  // shipping the firmware in docs/lsk-ble-contract.md is the lie this test
  // exists to make deliberate.
  assert.equal(LSK_BLE_FIRMWARE_STATUS, 'absent');
  assert.equal(bleLinkAvailability({ bluetooth: {} }).usable, false);
});

/* ── the picker ───────────────────────────────────────────────────────────── */

test('the picker is filtered to radios advertising the LSK service', async () => {
  let asked: { filters?: Array<{ services?: string[]; namePrefix?: string }> } | undefined;
  const device = new FakeDevice();
  const chosen = await requestLskBleDevice({
    bluetooth: {
      requestDevice: async (options: typeof asked) => {
        asked = options;
        return device;
      },
    },
  });
  assert.equal(chosen, device);
  assert.deepEqual(asked?.filters?.[0]?.services, [LSK_BLE_SERVICE_UUID]);
  assert.equal(asked?.filters?.[1]?.namePrefix, LSK_BLE_NAME_PREFIX);
});

test('requestLskBleDevice refuses a browser with no Web Bluetooth', async () => {
  await assert.rejects(() => requestLskBleDevice({}), /no Web Bluetooth/);
});

test('granted devices are empty rather than fatal when getDevices is absent', async () => {
  assert.deepEqual(await grantedLskBleDevices({ bluetooth: {} }), []);
  assert.deepEqual(
    await grantedLskBleDevices({
      bluetooth: {
        requestDevice: async () => new FakeDevice(),
        getDevices: async () => {
          throw new Error('permission policy blocked getDevices');
        },
      },
    }),
    [],
  );
});

/* ── framing across MTU-sized notifications ───────────────────────────────── */

test('an LSK line split across MTU notifications arrives whole and parses', async () => {
  const device = new FakeDevice();
  const transport = createBleTransport(device);
  const sink = collect();
  assert.equal(await transport.open(sink), 'opened');
  assert.equal(device.tx.notifying, true);

  const line =
    'LSK T {"bat":"BAT 87%","gps":"GPS FIX 7","profile":"LongFast","frames":1284,' +
    '"rssi_x10":-921,"snr_x10":74,"sim":false,"lat":37.4419,"lon":-122.143}';
  const pieces = chunksOf(`${line}\n`, DEFAULT_BLE_CHUNK_BYTES);
  assert.ok(pieces.length > 5, 'the fixture must actually span several notifications');
  for (const piece of pieces) {
    device.tx.notify(piece);
  }

  assert.deepEqual(sink.lines, [line]);
  const parsed = parseLskLine(sink.lines[0]);
  assert.equal(parsed?.kind, 'T');
  if (parsed?.kind !== 'T') return;
  assert.equal(parsed.telemetry.frames, 1284);
  assert.equal(parsed.telemetry.lat, 37.4419);
  await transport.close();
});

test('several LSK lines packed into one notification all arrive', async () => {
  const device = new FakeDevice();
  const transport = createBleTransport(device);
  const sink = collect();
  await transport.open(sink);
  device.tx.notify(
    new TextEncoder().encode('LSK ID {"fw":"0.1.0"}\nLSK OK {"proto":"meshtastic"}\nLSK T {'),
  );
  assert.deepEqual(sink.lines, ['LSK ID {"fw":"0.1.0"}', 'LSK OK {"proto":"meshtastic"}']);
  await transport.close();
});

test('a notification boundary inside a UTF-8 character does not corrupt the line', async () => {
  const device = new FakeDevice();
  const transport = createBleTransport(device);
  const sink = collect();
  await transport.open(sink);
  const line = 'LSK F {"src":1,"dst":2,"proto":"Meshtastic","port":1,"name":"Bahía Node"}';
  for (const piece of chunksOf(`${line}\n`, 7)) device.tx.notify(piece);
  assert.deepEqual(sink.lines, [line]);
  const parsed = parseLskLine(sink.lines[0]);
  assert.equal(parsed?.kind, 'F');
  if (parsed?.kind !== 'F') return;
  assert.equal(parsed.frame.name, 'Bahía Node');
  await transport.close();
});

test('a fragment left by a dropped link is not spliced onto the next one', async () => {
  const device = new FakeDevice();
  const transport = createBleTransport(device);
  const sink = collect();
  await transport.open(sink);
  device.tx.notify(new TextEncoder().encode('LSK T {"bat":"BAT 8'));
  await transport.close();

  const second = collect();
  assert.equal(await transport.open(second), 'opened');
  device.tx.notify(new TextEncoder().encode('LSK ID {"fw":"0.1.0"}\n'));
  assert.deepEqual(second.lines, ['LSK ID {"fw":"0.1.0"}']);
  await transport.close();
});

/* ── writes ───────────────────────────────────────────────────────────────── */

test('a written line is chunked to the ATT floor and rejoins newline-framed', async () => {
  const device = new FakeDevice();
  const transport = createBleTransport(device);
  await transport.open(collect());
  await transport.write('LSK TX meshtastic text hello from the browser');
  assert.ok(device.rx.writes.length > 1);
  for (const write of device.rx.writes) {
    assert.ok(write.length <= DEFAULT_BLE_CHUNK_BYTES);
  }
  assert.equal(device.rx.writtenText(), 'LSK TX meshtastic text hello from the browser\n');
  await transport.close();
});

test('the handshake fits one write and still carries its newline', async () => {
  const device = new FakeDevice();
  const transport = createBleTransport(device);
  await transport.open(collect());
  await transport.write('LSK HELLO');
  assert.equal(device.rx.writes.length, 1);
  assert.equal(device.rx.writtenText(), 'LSK HELLO\n');
  await transport.close();
});

test('a negotiated larger MTU means fewer writes for the same line', async () => {
  const device = new FakeDevice();
  const transport = createBleTransport(device, { chunkBytes: 244 });
  await transport.open(collect());
  await transport.write('LSK TX meshtastic text hello from the browser');
  assert.equal(device.rx.writes.length, 1);
  assert.equal(device.rx.writtenText(), 'LSK TX meshtastic text hello from the browser\n');
  await transport.close();
});

/* ── drops, reconnect, wrong firmware ─────────────────────────────────────── */

test('a link that dies on its own is reported as a drop', async () => {
  const device = new FakeDevice();
  const transport = createBleTransport(device);
  const sink = collect();
  await transport.open(sink);
  device.dropLink();
  assert.equal(sink.drops, 1);
  await transport.close();
});

test('a disconnect we asked for is not reported as a drop', async () => {
  const device = new FakeDevice();
  const transport = createBleTransport(device);
  const sink = collect();
  await transport.open(sink);
  await transport.close();
  device.dropLink();
  assert.equal(sink.drops, 0);
  assert.equal(device.tx.notifying, false);
});

test('reopening reconnects the same device without a second picker prompt', async () => {
  const device = new FakeDevice();
  const transport = createBleTransport(device);
  await transport.open(collect());
  await transport.close();
  const sink = collect();
  assert.equal(await transport.open(sink), 'opened');
  assert.equal(device.connects, 2);
  assert.equal(device.tx.notifying, true);
  device.tx.notify(new TextEncoder().encode('LSK ID {"fw":"0.1.0"}\n'));
  assert.deepEqual(sink.lines, ['LSK ID {"fw":"0.1.0"}']);
  await transport.close();
});

test('firmware without the LSK service reads as busy, not as a wrong device', async () => {
  const device = new FakeDevice();
  device.serveLsk = false;
  const transport = createBleTransport(device);
  const sink = collect();
  assert.equal(await transport.open(sink), 'busy');
  assert.equal(sink.drops, 0, 'a failed open is not a drop');
  assert.equal(device.connected, false, 'a failed open must release the radio');
});

test('a device with no GATT server reads as busy', async () => {
  const transport = createBleTransport({
    addEventListener() {},
    removeEventListener() {},
  });
  assert.equal(await transport.open(collect()), 'busy');
});

test('the transport names itself for the UI', () => {
  const transport = createBleTransport(new FakeDevice());
  assert.equal(transport.kind, 'ble');
  assert.equal(transport.label, 'Bluetooth');
});
