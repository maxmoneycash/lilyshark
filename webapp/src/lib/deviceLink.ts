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

/** ~10 minutes at one sample every 2 s. Older points fall off the front. */
export const TELEMETRY_HISTORY_LIMIT = 300;

export interface DeviceTelemetry {
  bat: string;
  gps: string;
  profile: string;
  frames: number;
  rssiX10: number;
  snrX10: number;
  sim: boolean;
  /** Present only when the firmware sent a GPS fix. */
  lat?: number;
  lon?: number;
  mv?: number;
  pct?: number;
  sat?: number;
  freqHz?: number;
  sf?: number;
  bwHz?: number;
  rx?: number;
  crc?: number;
  atMs: number;
}

export interface HeardFrame {
  src: number;
  dst: number;
  proto: string;
  port: number;
  hops?: number;
  rssiX10: number;
  snrX10: number;
  kind: string;
  sim: boolean;
  lat?: number;
  lon?: number;
  name?: string;
  short?: string;
  text?: string;
  atMs: number;
}

export const HEARD_FRAME_LIMIT = 40;

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
  /** Newest last. Bounded by TELEMETRY_HISTORY_LIMIT. */
  history: DeviceTelemetry[];
  /** Newest last. Bounded by HEARD_FRAME_LIMIT. */
  frames: HeardFrame[];
  pointer?: DevicePointer;
}

export type ParsedLsk =
  | { kind: 'ID'; firmware: string }
  | { kind: 'T'; telemetry: DeviceTelemetry }
  | { kind: 'F'; frame: HeardFrame }
  | { kind: 'P'; pointer: DevicePointer };

function optionalCoord(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalStr(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  return s.length > 0 ? s : undefined;
}

/** Pure parse of one newline-stripped analyzer line. Undefined if it is not LSK. */
export function parseLskLine(line: string): ParsedLsk | undefined {
  const sp = line.indexOf(' ', 4);
  if (!line.startsWith('LSK ') || sp < 0) return undefined;
  const kind = line.slice(4, sp);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(line.slice(sp + 1)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (kind === 'ID') {
    return { kind: 'ID', firmware: String(body.fw ?? '') };
  }
  if (kind === 'T') {
    const lat = optionalCoord(body.lat);
    const lon = optionalCoord(body.lon);
    return {
      kind: 'T',
      telemetry: {
        bat: String(body.bat ?? ''),
        gps: String(body.gps ?? ''),
        profile: String(body.profile ?? ''),
        frames: Number(body.frames ?? 0),
        rssiX10: Number(body.rssi_x10 ?? 0),
        snrX10: Number(body.snr_x10 ?? 0),
        sim: body.sim === true,
        ...(lat !== undefined ? { lat } : {}),
        ...(lon !== undefined ? { lon } : {}),
        ...(optionalNum(body.mv) !== undefined ? { mv: optionalNum(body.mv) } : {}),
        ...(optionalNum(body.pct) !== undefined ? { pct: optionalNum(body.pct) } : {}),
        ...(optionalNum(body.sat) !== undefined ? { sat: optionalNum(body.sat) } : {}),
        ...(optionalNum(body.freq_hz) !== undefined ? { freqHz: optionalNum(body.freq_hz) } : {}),
        ...(optionalNum(body.sf) !== undefined ? { sf: optionalNum(body.sf) } : {}),
        ...(optionalNum(body.bw_hz) !== undefined ? { bwHz: optionalNum(body.bw_hz) } : {}),
        ...(optionalNum(body.rx) !== undefined ? { rx: optionalNum(body.rx) } : {}),
        ...(optionalNum(body.crc) !== undefined ? { crc: optionalNum(body.crc) } : {}),
        atMs: Date.now(),
      },
    };
  }
  if (kind === 'F') {
    const lat = optionalCoord(body.lat);
    const lon = optionalCoord(body.lon);
    const hops = optionalNum(body.hops);
    return {
      kind: 'F',
      frame: {
        src: Number(body.src ?? 0),
        dst: Number(body.dst ?? 0),
        proto: String(body.proto ?? 'Unknown'),
        port: Number(body.port ?? 0),
        ...(hops !== undefined && hops >= 0 ? { hops } : {}),
        rssiX10: Number(body.rssi_x10 ?? 0),
        snrX10: Number(body.snr_x10 ?? 0),
        kind: String(body.kind ?? 'RAW'),
        sim: body.sim === true,
        ...(lat !== undefined ? { lat } : {}),
        ...(lon !== undefined ? { lon } : {}),
        ...(optionalStr(body.name) ? { name: optionalStr(body.name) } : {}),
        ...(optionalStr(body.short) ? { short: optionalStr(body.short) } : {}),
        ...(optionalStr(body.text) ? { text: optionalStr(body.text) } : {}),
        atMs: Date.now(),
      },
    };
  }
  if (kind === 'P') {
    return {
      kind: 'P',
      pointer: {
        sizeBytes: Number(body.size ?? 0),
        expiresAtUnix: Number(body.expires ?? 0),
        owner: String(body.owner ?? ''),
        commitment: String(body.commit ?? ''),
        atMs: Date.now(),
      },
    };
  }
  return undefined;
}

export function appendTelemetryHistory(
  history: DeviceTelemetry[],
  sample: DeviceTelemetry,
): DeviceTelemetry[] {
  const next =
    history.length >= TELEMETRY_HISTORY_LIMIT
      ? history.slice(history.length - TELEMETRY_HISTORY_LIMIT + 1)
      : history.slice();
  next.push(sample);
  return next;
}

export function appendHeardFrame(frames: HeardFrame[], frame: HeardFrame): HeardFrame[] {
  const next =
    frames.length >= HEARD_FRAME_LIMIT
      ? frames.slice(frames.length - HEARD_FRAME_LIMIT + 1)
      : frames.slice();
  next.push(frame);
  return next;
}

let state: DeviceLinkState = { status: 'off', history: [], frames: [] };

export function getDeviceLinkState(): DeviceLinkState {
  return state;
}
const listeners = new Set<() => void>();

let port: SerialPort | undefined;
let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
let pumpDone: Promise<void> | undefined;
/** False means a disconnect was asked for, so a read ending is not a fault. */
let reading = false;
let identified: ((ok: boolean) => void) | undefined;

let onAnalyzerLink: (() => void) | undefined;
let onAnalyzerUnlink: (() => void) | undefined;
let onAnalyzerTelemetry: ((sample: DeviceTelemetry) => void) | undefined;
let onAnalyzerFrame: ((frame: HeardFrame) => void) | undefined;

export function setAnalyzerMeshSink(sink: {
  onLink?: () => void;
  onUnlink?: () => void;
  onTelemetry?: (sample: DeviceTelemetry) => void;
  onFrame?: (frame: HeardFrame) => void;
}): void {
  onAnalyzerLink = sink.onLink;
  onAnalyzerUnlink = sink.onUnlink;
  onAnalyzerTelemetry = sink.onTelemetry;
  onAnalyzerFrame = sink.onFrame;
}

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
  const parsed = parseLskLine(line);
  if (!parsed) return;
  if (parsed.kind === 'ID') {
    set({
      status: 'linked',
      firmware: parsed.firmware,
      error: undefined,
      canPick: undefined,
    });
    identified?.(true);
    onAnalyzerLink?.();
  } else if (parsed.kind === 'T') {
    set({
      status: 'linked',
      telemetry: parsed.telemetry,
      history: appendTelemetryHistory(state.history, parsed.telemetry),
    });
    onAnalyzerTelemetry?.(parsed.telemetry);
  } else if (parsed.kind === 'F') {
    set({
      status: 'linked',
      frames: appendHeardFrame(state.frames, parsed.frame),
    });
    onAnalyzerFrame?.(parsed.frame);
  } else if (parsed.kind === 'P') {
    set({ pointer: parsed.pointer });
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
    history: [],
    frames: [],
    pointer: undefined,
    firmware: undefined,
    error: undefined,
    canPick: undefined,
  });
  onAnalyzerUnlink?.();
}
