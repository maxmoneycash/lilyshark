/**
 * The Lilyshark analyzer link: lilyshark.com talking to a T-Deck running
 * Lilyshark firmware over Web Serial.
 *
 * This is not the MeshCore companion protocol — Lilyshark is the instrument,
 * not the messenger, so its link is the instrument's: a "LSK HELLO"
 * handshake, then newline-delimited telemetry lines ("LSK T {...}") every
 * couple of seconds and a full-coordinates pointer line ("LSK P {...}")
 * whenever the device decodes a Shelby pointer off the air. Plain text, so a
 * serial monitor shows a human exactly what the browser sees.
 *
 * Finding the radio is half the problem. A Mac lists Bluetooth ports, headset
 * ports and a debug console alongside the board, and any of them opens
 * happily and then says nothing — which reads as a hang, not a wrong choice.
 * So candidates are filtered to USB serial vendors, each one is asked to
 * identify itself, and only a port that answers becomes the link.
 */

import { useSyncExternalStore } from 'react';

/** USB vendors that put a serial device on a dev board: Espressif's native
 *  USB (the T-Deck), then the CH34x / CP210x / FTDI bridges other boards use.
 *  Bluetooth and console ports report no USB vendor at all, so this alone
 *  clears the noise off the picker. */
const ESPRESSIF_USB_VENDOR = 0x303a;
const KNOWN_USB_VENDORS = [ESPRESSIF_USB_VENDOR, 0x1a86, 0x10c4, 0x0403];
const PORT_FILTERS = KNOWN_USB_VENDORS.map((usbVendorId) => ({ usbVendorId }));

/** How long a port gets to answer LSK HELLO before we move on. Generous: the
 *  device may be mid-boot when we attach. */
const HANDSHAKE_TIMEOUT_MS = 8000;
/** A reboot costs the device its USB enumeration; this is the wait before
 *  reopening after an unexpected drop. */
const REENUMERATE_WAIT_MS = 9000;

export interface DeviceTelemetry {
  bat: string;
  gps: string;
  profile: string;
  frames: number;
  rssiX10: number;
  snrX10: number;
  sim: boolean;
}

export interface DevicePointer {
  sizeBytes: number;
  expiresAtUnix: number;
  owner: string;
  commitment: string;
  atMs: number;
}

export interface DeviceLinkState {
  status: 'off' | 'connecting' | 'linked' | 'error';
  firmware?: string;
  error?: string;
  /** True when the error can be cleared by picking a different port. */
  canPick?: boolean;
  telemetry?: DeviceTelemetry;
  pointer?: DevicePointer;
}

let state: DeviceLinkState = { status: 'off' };
const listeners = new Set<() => void>();

let port: SerialPort | undefined;
let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
let pumpDone: Promise<void> | undefined;
/** False means a disconnect was asked for, so a read ending is not a fault. */
let reading = false;
let identified: ((ok: boolean) => void) | undefined;

function set(next: Partial<DeviceLinkState>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function useDeviceLink(): DeviceLinkState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

async function send(line: string): Promise<void> {
  await writer?.write(new TextEncoder().encode(line + '\n'));
}

function handleLine(line: string): void {
  const sp = line.indexOf(' ', 4);
  if (!line.startsWith('LSK ') || sp < 0) return;
  const kind = line.slice(4, sp);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(line.slice(sp + 1)) as Record<string, unknown>;
  } catch {
    return;
  }
  if (kind === 'ID') {
    set({
      status: 'linked',
      firmware: String(body.fw ?? ''),
      error: undefined,
      canPick: undefined,
    });
    identified?.(true);
  } else if (kind === 'T') {
    set({
      status: 'linked',
      telemetry: {
        bat: String(body.bat ?? ''),
        gps: String(body.gps ?? ''),
        profile: String(body.profile ?? ''),
        frames: Number(body.frames ?? 0),
        rssiX10: Number(body.rssi_x10 ?? 0),
        snrX10: Number(body.snr_x10 ?? 0),
        sim: body.sim === true,
      },
    });
  } else if (kind === 'P') {
    set({
      pointer: {
        sizeBytes: Number(body.size ?? 0),
        expiresAtUnix: Number(body.expires ?? 0),
        owner: String(body.owner ?? ''),
        commitment: String(body.commit ?? ''),
        atMs: Date.now(),
      },
    });
  }
}

async function teardown(): Promise<void> {
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
    await port?.close();
  } catch {
    /* already gone */
  }
  activeReader = undefined;
  writer = undefined;
  port = undefined;
  pumpDone = undefined;
}

/** Stream lines until the port ends, then recover a reboot or report the drop. */
async function pump(candidate: SerialPort, attempt: number): Promise<void> {
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (reading && activeReader) {
      const { value, done } = await activeReader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let nl = pending.indexOf('\n');
      while (nl >= 0) {
        handleLine(pending.slice(0, nl).trim());
        pending = pending.slice(nl + 1);
        nl = pending.indexOf('\n');
      }
    }
  } catch {
    /* unplugged or rebooted mid-read */
  }
  if (!reading) return; // deliberate disconnect
  identified?.(false);

  // Opening a CDC port can flick the ESP32-S3's reset lines, so a drop right
  // after connecting usually means the device is rebooting, not missing.
  void (async () => {
    await teardown();
    if (attempt >= 2) {
      set({ status: 'error', error: 'link dropped — replug the device and retry', canPick: true });
      return;
    }
    set({ status: 'connecting', error: undefined });
    await new Promise((r) => setTimeout(r, REENUMERATE_WAIT_MS));
    if (!(await attemptPort(candidate, attempt + 1))) {
      set({
        status: 'error',
        error: 'the device stopped answering — replug it and retry',
        canPick: true,
      });
    }
  })();
}

/** Open one port and ask it to identify. True only if Lilyshark answered. */
async function attemptPort(candidate: SerialPort, attempt = 0): Promise<boolean> {
  try {
    await candidate.open({ baudRate: 115200 });
  } catch {
    return false; // busy (another tab) or gone
  }
  try {
    // Hold reset and boot lines released; without this the open itself can
    // restart the device, or worse, drop it into the bootloader.
    await candidate.setSignals({ dataTerminalReady: false, requestToSend: false });
  } catch {
    /* not every platform exposes setSignals */
  }

  port = candidate;
  writer = candidate.writable?.getWriter();
  activeReader = candidate.readable?.getReader();
  if (!writer || !activeReader) {
    await teardown();
    return false;
  }
  reading = true;
  pumpDone = pump(candidate, attempt);

  const answered = await new Promise<boolean>((resolve) => {
    // The firmware may be mid-line or mid-boot, so the hello repeats.
    const hello = setInterval(() => void send('LSK HELLO'), 1200);
    const timer = setTimeout(() => finish(false), HANDSHAKE_TIMEOUT_MS);
    const finish = (ok: boolean) => {
      clearInterval(hello);
      clearTimeout(timer);
      identified = undefined;
      resolve(ok);
    };
    identified = finish;
    void send('LSK HELLO');
  });

  if (!answered) await teardown();
  return answered;
}

async function grantedCandidates(vendors: number[] = KNOWN_USB_VENDORS): Promise<SerialPort[]> {
  const ports = await navigator.serial.getPorts();
  return ports.filter((p) => {
    const vendor = p.getInfo().usbVendorId;
    return vendor !== undefined && vendors.includes(vendor);
  });
}

/**
 * Link to a T-Deck. Tries every already-granted USB serial port, keeping the
 * first that identifies as Lilyshark; opens the picker (filtered to real USB
 * serial devices) when none does.
 */
export async function connectDeviceLink(options: { picker?: boolean } = {}): Promise<void> {
  if (!('serial' in navigator)) {
    set({ status: 'error', error: 'this browser has no Web Serial — use Chrome, Edge or Arc' });
    return;
  }
  if (state.status === 'connecting') return;
  set({ status: 'connecting', error: undefined, canPick: undefined });

  try {
    if (!options.picker) {
      for (const candidate of await grantedCandidates()) {
        if (await attemptPort(candidate)) return;
      }
    }
    // Nothing answered: ask the user which device, listing only USB serial
    // hardware so a headset or Bluetooth port cannot be chosen by mistake.
    const chosen = await navigator.serial.requestPort({ filters: PORT_FILTERS });
    if (await attemptPort(chosen)) return;
    set({
      status: 'error',
      error: 'that port never answered — is the T-Deck powered on and running Lilyshark?',
      canPick: true,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'connection failed';
    set({
      status: 'error',
      canPick: true,
      error: /No port selected/i.test(message)
        ? 'no device chosen'
        : /Failed to open/i.test(message)
          ? 'port is busy — close other lilyshark.com tabs or serial monitors, then retry'
          : message,
    });
  }
}

/**
 * Link without prompting, for a device the browser already has permission
 * for: plug in, open the analyzer, and the panel fills itself. Silent when
 * there is nothing to link — an unasked-for attempt must not raise errors.
 */
export async function autoLinkDeviceLink(): Promise<void> {
  if (!('serial' in navigator) || state.status !== 'off') return;
  // Unprompted, only the T-Deck's own USB controller is fair game. The wider
  // bridge-chip list belongs to the deliberate path: writing HELLO into
  // whatever Arduino or CNC controller this origin was once granted is not
  // something a page should do on its own.
  const candidates = await grantedCandidates([ESPRESSIF_USB_VENDOR]);
  if (candidates.length === 0) return;
  set({ status: 'connecting', error: undefined });
  for (const candidate of candidates) {
    if (await attemptPort(candidate)) return;
  }
  set({ status: 'off', error: undefined });
}

export async function disconnectDeviceLink(): Promise<void> {
  try {
    await send('LSK BYE');
  } catch {
    /* already gone */
  }
  await teardown();
  set({
    status: 'off',
    telemetry: undefined,
    pointer: undefined,
    firmware: undefined,
    error: undefined,
    canPick: undefined,
  });
}
