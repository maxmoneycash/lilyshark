/**
 * The Web Serial transport for the LSK link — the original Lilyshark link,
 * lifted out of deviceLink.ts behind the DeviceTransport interface and
 * otherwise unchanged.
 *
 * Finding the radio is half the problem. A Mac lists Bluetooth ports, headset
 * ports and a debug console alongside the board, and any of them opens
 * happily and then says nothing — which reads as a hang, not a wrong choice.
 * So candidates are filtered to USB serial vendors here, and the handshake in
 * deviceLink.ts asks each one to identify itself.
 */

import {
  type DeviceTransport,
  encodeLine,
  LineAssembler,
  type TransportOpenResult,
  type TransportSink,
} from './deviceTransport';

/** USB vendors that put a serial device on a dev board: Espressif's native
 *  USB (the T-Deck), then the CH34x / CP210x / FTDI bridges other boards use.
 *  Bluetooth and console ports report no USB vendor at all, so this alone
 *  clears the noise off the picker. */
export const ESPRESSIF_USB_VENDOR = 0x303a;
export const KNOWN_USB_VENDORS = [ESPRESSIF_USB_VENDOR, 0x1a86, 0x10c4, 0x0403];
export const PORT_FILTERS = KNOWN_USB_VENDORS.map((usbVendorId) => ({ usbVendorId }));

export const SERIAL_BAUD_RATE = 115200;

/** A stream that ends but has not dropped gets re-acquired after this. */
const REACQUIRE_WAIT_MS = 200;

export function isWebSerialAvailable(navigatorLike: unknown = globalThis.navigator): boolean {
  return typeof navigatorLike === 'object' && navigatorLike !== null && 'serial' in navigatorLike;
}

export async function grantedSerialPorts(
  vendors: number[] = KNOWN_USB_VENDORS,
): Promise<SerialPort[]> {
  const ports = await navigator.serial.getPorts();
  return ports.filter((p) => {
    const vendor = p.getInfo().usbVendorId;
    return vendor !== undefined && vendors.includes(vendor);
  });
}

/** Ask the user which device, listing only USB serial hardware so a headset
 *  or Bluetooth port cannot be chosen by mistake. */
export function requestSerialPort(): Promise<SerialPort> {
  return navigator.serial.requestPort({ filters: PORT_FILTERS });
}

export function createSerialTransport(port: SerialPort): DeviceTransport {
  let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let pumpDone: Promise<void> | undefined;
  /** False means a disconnect was asked for, so a read ending is not a fault. */
  let reading = false;
  let sink: TransportSink | undefined;
  const assembler = new LineAssembler();

  async function openPort(): Promise<boolean> {
    try {
      await port.open({ baudRate: SERIAL_BAUD_RATE });
      return true;
    } catch {
      /* already open in this origin, or held by another tab */
    }
    try {
      await port.close();
    } catch {
      /* was not ours */
    }
    try {
      await port.open({ baudRate: SERIAL_BAUD_RATE });
      return true;
    } catch {
      return false;
    }
  }

  async function readAvailable(): Promise<void> {
    while (reading) {
      // Local alias: close() clears activeReader from another task, so
      // TypeScript cannot keep it narrowed across the awaits.
      let reader = activeReader;
      if (!reader) {
        const readable = port.readable;
        if (!readable) return;
        try {
          reader = readable.getReader();
        } catch {
          return;
        }
        activeReader = reader;
      }
      try {
        const { value, done } = await reader.read();
        if (done) {
          try {
            reader.releaseLock();
          } catch {
            /* already released */
          }
          activeReader = undefined;
          await new Promise((r) => setTimeout(r, REACQUIRE_WAIT_MS));
          continue;
        }
        for (const line of assembler.push(value)) sink?.onLine(line);
      } catch {
        try {
          reader.releaseLock();
        } catch {
          /* already released */
        }
        activeReader = undefined;
        await new Promise((r) => setTimeout(r, REACQUIRE_WAIT_MS));
      }
    }
  }

  /** Stream lines until the port ends. A drop during handshake is a reboot,
   *  not a failed identity check — the opener decides whether to retry. */
  async function pump(): Promise<void> {
    try {
      await readAvailable();
    } catch {
      /* unplugged or rebooted mid-read */
    }
    if (!reading) return;
    sink?.onDrop();
  }

  async function close(): Promise<void> {
    reading = false;
    try {
      await activeReader?.cancel();
    } catch {
      /* already gone */
    }
    try {
      await pumpDone;
    } catch {
      /* already gone */
    }
    try {
      writer?.releaseLock();
    } catch {
      /* already gone */
    }
    try {
      await port.close();
    } catch {
      /* already gone */
    }
    activeReader = undefined;
    writer = undefined;
    pumpDone = undefined;
    sink = undefined;
    assembler.reset();
  }

  return {
    kind: 'serial',
    label: 'USB',
    async open(nextSink: TransportSink): Promise<TransportOpenResult> {
      if (!(await openPort())) return 'busy';
      try {
        // Release reset/boot after the host has opened. Too late to prevent
        // the first CDC reset, but it keeps the board out of the bootloader.
        await port.setSignals({ dataTerminalReady: false, requestToSend: false });
      } catch {
        /* not every platform exposes setSignals */
      }

      sink = nextSink;
      writer = port.writable?.getWriter();
      activeReader = port.readable?.getReader();
      if (!writer || !activeReader) {
        await close();
        return 'busy';
      }
      reading = true;
      pumpDone = pump();
      return 'opened';
    },
    async write(line: string): Promise<void> {
      await writer?.write(encodeLine(line));
    },
    close,
  };
}
