import assert from 'node:assert/strict';
import test from 'node:test';

import type { TransportSink } from './deviceTransport';
import {
  createSerialTransport,
  ESPRESSIF_USB_VENDOR,
  isWebSerialAvailable,
  KNOWN_USB_VENDORS,
  PORT_FILTERS,
  SERIAL_BAUD_RATE,
} from './serialTransport';

/** A Web Serial port the test drives: it enqueues bytes the way a T-Deck
 *  would, and can vanish the way an unplugged one does. */
class FakeSerialPort {
  opens = 0;
  closes = 0;
  baudRates: number[] = [];
  signals: Array<Record<string, boolean>> = [];
  written: Uint8Array[] = [];
  /** Set to fail the first open, the way a port held by another tab does. */
  openFailures = 0;
  readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array>;
  private controller?: ReadableStreamDefaultController<Uint8Array>;

  constructor() {
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.written.push(new Uint8Array(chunk));
      },
    });
  }

  async open(options: { baudRate: number }): Promise<void> {
    if (this.openFailures > 0) {
      this.openFailures -= 1;
      throw new Error('Failed to open serial port.');
    }
    this.opens += 1;
    this.baudRates.push(options.baudRate);
  }

  async close(): Promise<void> {
    this.closes += 1;
  }

  async setSignals(next: Record<string, boolean>): Promise<void> {
    this.signals.push(next);
  }

  emit(text: string): void {
    this.controller?.enqueue(new TextEncoder().encode(text));
  }

  /** The cable coming out: the stream ends and the port stops offering one. */
  unplug(): void {
    try {
      this.controller?.close();
    } catch {
      /* already closed */
    }
    this.readable = null;
  }

  writtenText(): string {
    return this.written.map((w) => new TextDecoder().decode(w)).join('');
  }
}

const asPort = (fake: FakeSerialPort): SerialPort => fake as unknown as SerialPort;

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

/** The pump hands lines up from another task; let it run. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

test('the picker filter keeps only USB serial vendors', () => {
  assert.ok(KNOWN_USB_VENDORS.includes(ESPRESSIF_USB_VENDOR));
  assert.deepEqual(
    PORT_FILTERS,
    KNOWN_USB_VENDORS.map((usbVendorId) => ({ usbVendorId })),
  );
  assert.equal(isWebSerialAvailable({}), false);
  assert.equal(isWebSerialAvailable({ serial: {} }), true);
});

test('opening a port sets the analyzer baud rate and releases boot signals', async () => {
  const fake = new FakeSerialPort();
  const transport = createSerialTransport(asPort(fake));
  assert.equal(await transport.open(collect()), 'opened');
  assert.deepEqual(fake.baudRates, [SERIAL_BAUD_RATE]);
  assert.deepEqual(fake.signals, [{ dataTerminalReady: false, requestToSend: false }]);
  assert.equal(transport.kind, 'serial');
  assert.equal(transport.label, 'USB');
  await transport.close();
});

test('a port held by another tab is closed and reopened before giving up', async () => {
  const fake = new FakeSerialPort();
  fake.openFailures = 1;
  const transport = createSerialTransport(asPort(fake));
  assert.equal(await transport.open(collect()), 'opened');
  assert.equal(fake.closes, 1, 'the stale handle is closed first');
  assert.equal(fake.opens, 1);
  await transport.close();
});

test('a port that never opens reads as busy', async () => {
  const fake = new FakeSerialPort();
  fake.openFailures = 2;
  const transport = createSerialTransport(asPort(fake));
  assert.equal(await transport.open(collect()), 'busy');
});

test('lines split across USB reads arrive whole', async () => {
  const fake = new FakeSerialPort();
  const transport = createSerialTransport(asPort(fake));
  const sink = collect();
  await transport.open(sink);
  fake.emit('Lilyshark starting\r\nLSK ID {"app":"lilyshark",');
  fake.emit('"fw":"0.1.0"}\nLSK T {"bat"');
  await settle();
  assert.deepEqual(sink.lines, [
    'Lilyshark starting',
    'LSK ID {"app":"lilyshark","fw":"0.1.0"}',
  ]);
  assert.equal(sink.drops, 0);
  await transport.close();
});

test('a written line reaches the port newline-framed', async () => {
  const fake = new FakeSerialPort();
  const transport = createSerialTransport(asPort(fake));
  await transport.open(collect());
  await transport.write('LSK HELLO');
  assert.equal(fake.writtenText(), 'LSK HELLO\n');
  await transport.close();
});

test('an unplugged cable is a drop', async () => {
  const fake = new FakeSerialPort();
  const transport = createSerialTransport(asPort(fake));
  const sink = collect();
  await transport.open(sink);
  fake.emit('LSK ID {"fw":"0.1.0"}\n');
  await settle();
  fake.unplug();
  // The reader re-acquires once before deciding the port is gone.
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(sink.drops, 1);
  await transport.close();
});

test('a close we asked for is not a drop', async () => {
  const fake = new FakeSerialPort();
  const transport = createSerialTransport(asPort(fake));
  const sink = collect();
  await transport.open(sink);
  await transport.close();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(sink.drops, 0);
  assert.equal(fake.closes, 1);
});
