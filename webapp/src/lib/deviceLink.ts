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
import { recordFrame } from './captureSession';

/** USB vendors that put a serial device on a dev board: Espressif's native
 *  USB (the T-Deck), then the CH34x / CP210x / FTDI bridges other boards use.
 *  Bluetooth and console ports report no USB vendor at all, so this alone
 *  clears the noise off the picker. */
const ESPRESSIF_USB_VENDOR = 0x303a;
const KNOWN_USB_VENDORS = [ESPRESSIF_USB_VENDOR, 0x1a86, 0x10c4, 0x0403];
const PORT_FILTERS = KNOWN_USB_VENDORS.map((usbVendorId) => ({ usbVendorId }));

/** How long a single open port gets to answer LSK HELLO. Opening ESP32-S3
 *  native USB almost always resets the board, and Lilyshark only reads the
 *  serial line after setup() finishes (display, GPS, radio). */
export const HANDSHAKE_TIMEOUT_MS = 20000;
/** Wait after a CDC drop before reopening. The T-Deck re-enumerates here. */
export const REENUMERATE_WAIT_MS = 4000;
/** Opens that may reboot the chip. First drop is expected, not a failure. */
export const HANDSHAKE_MAX_ATTEMPTS = 3;
/** Let the board come out of reset before the first HELLO on this open. */
const HELLO_AFTER_OPEN_MS = 800;

export type SerialLinkAction = 'ignore' | 'retry' | 'fail';

/** Decide what a dropped CDC stream or handshake timeout means. */
export function nextSerialAction(input: {
  event: 'stream-drop' | 'timeout';
  deliberate: boolean;
  attempt: number;
  maxAttempts?: number;
}): SerialLinkAction {
  if (input.deliberate) return 'ignore';
  const max = input.maxAttempts ?? HANDSHAKE_MAX_ATTEMPTS;
  return input.attempt + 1 < max ? 'retry' : 'fail';
}

export function isLilysharkBanner(line: string): boolean {
  return (
    line.startsWith('Lilyshark starting') ||
    line.includes('Lilyshark UI ready') ||
    line.startsWith('LSK ')
  );
}

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
  /** Everything a .lscap record needs. Absent on firmware older than the
   *  capture link, in which case the frame still lists but cannot be written
   *  into a capture. */
  raw?: RawFrameFields;
}

/** The record fields the device puts on the wire alongside the decoded view. */
export interface RawFrameFields {
  seq: number;
  timestampUs: bigint;
  /** Firmware fixed point, kept as-is because that is how .lscap stores it. */
  rssiX10: number;
  snrX10: number;
  presentFields: number;
  centerFrequencyHz: number;
  bandwidthHz: number;
  bitRateBps: number;
  frequencyDeviationHz: number;
  airtimeUs: number;
  frequencyErrorHz: number;
  preambleSymbols: number;
  syncWord: number;
  profileId: number;
  radioStatus: number;
  txPowerDbm: number;
  spreadingFactor: number;
  codingRateDenominator: number;
  channelIndex: number;
  radioIndex: number;
  modulation: number;
  direction: number;
  crc: number;
  metadataFlags: number;
  originalLength: number;
  bytes: Uint8Array;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : hex.slice(0, -1);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Undefined unless the device sent the whole record — a partial one would
 *  produce a capture that looks complete and is not. */
export function parseRawFrameFields(
  body: Record<string, unknown>,
): RawFrameFields | undefined {
  if (typeof body.hex !== 'string' || typeof body.seq !== 'number') return undefined;
  const n = (k: string) => Number(body[k] ?? 0);
  return {
    seq: n('seq'),
    timestampUs: BigInt(Math.max(0, Math.trunc(n('ts')))),
    rssiX10: n('rssi_x10'),
    snrX10: n('snr_x10'),
    presentFields: n('pf'),
    centerFrequencyHz: n('freq'),
    bandwidthHz: n('bw'),
    bitRateBps: n('br'),
    frequencyDeviationHz: n('fdev'),
    airtimeUs: n('air'),
    frequencyErrorHz: n('ferr'),
    preambleSymbols: n('pre'),
    syncWord: n('sync'),
    profileId: n('prof'),
    radioStatus: n('rstat'),
    txPowerDbm: n('txp'),
    spreadingFactor: n('sf'),
    codingRateDenominator: n('cr'),
    channelIndex: n('ch'),
    radioIndex: n('ridx'),
    modulation: n('mod'),
    direction: n('dir'),
    crc: n('crc'),
    metadataFlags: n('mflags'),
    originalLength: n('olen'),
    bytes: hexToBytes(body.hex),
  };
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
  /** Latest serial line, shown while connecting so a silent fail is visible. */
  lastRx?: string;
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
  | { kind: 'P'; pointer: DevicePointer }
  | { kind: 'OK'; proto?: string; txKind?: string }
  | { kind: 'ERR'; reason?: string; proto?: string };

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
    const raw = parseRawFrameFields(body);
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
        ...(raw !== undefined ? { raw } : {}),
      },
    };
  }
  if (kind === 'OK') {
    return {
      kind: 'OK',
      proto: optionalStr(body.proto),
      txKind: optionalStr(body.kind),
    };
  }
  if (kind === 'ERR') {
    return {
      kind: 'ERR',
      reason: optionalStr(body.reason),
      proto: optionalStr(body.proto),
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
let identified: (() => void) | undefined;
let streamEnded: (() => void) | undefined;
let pendingTx:
  | { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  | undefined;

function finishPendingTx(ok: boolean, reason?: string): void {
  if (!pendingTx) return;
  clearTimeout(pendingTx.timer);
  const waiter = pendingTx;
  pendingTx = undefined;
  if (ok) waiter.resolve();
  else waiter.reject(new Error(reason || 'radio rejected TX'));
}

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

function markLinked(firmware?: string): void {
  const wasLinked = state.status === 'linked';
  set({
    status: 'linked',
    firmware: firmware || state.firmware,
    error: undefined,
    canPick: undefined,
  });
  identified?.();
  if (!wasLinked) onAnalyzerLink?.();
}

function handleLine(line: string): void {
  if (line) set({ lastRx: line.slice(0, 160) });
  const parsed = parseLskLine(line);
  if (!parsed) return;
  if (parsed.kind === 'ID') {
    markLinked(parsed.firmware);
  } else if (parsed.kind === 'T') {
    markLinked(state.firmware);
    set({
      telemetry: parsed.telemetry,
      history: appendTelemetryHistory(state.history, parsed.telemetry),
    });
    onAnalyzerTelemetry?.(parsed.telemetry);
  } else if (parsed.kind === 'F') {
    markLinked(state.firmware);
    set({
      frames: appendHeardFrame(state.frames, parsed.frame),
    });
    // A capture session keeps the full record; the list above keeps only the
    // newest few for display.
    recordFrame(parsed.frame);
    onAnalyzerFrame?.(parsed.frame);
  } else if (parsed.kind === 'P') {
    set({ pointer: parsed.pointer });
  } else if (parsed.kind === 'OK') {
    finishPendingTx(true);
  } else if (parsed.kind === 'ERR') {
    finishPendingTx(false, parsed.reason);
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

async function readAvailable(candidate: SerialPort): Promise<void> {
  const decoder = new TextDecoder();
  let pending = '';
  while (reading) {
    if (!activeReader) {
      const readable = candidate.readable;
      if (!readable) return;
      try {
        activeReader = readable.getReader();
      } catch {
        return;
      }
    }
    try {
      const { value, done } = await activeReader.read();
      if (done) {
        try {
          activeReader.releaseLock();
        } catch {
          /* already released */
        }
        activeReader = undefined;
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      pending += decoder.decode(value, { stream: true });
      let nl = pending.indexOf('\n');
      while (nl >= 0) {
        handleLine(pending.slice(0, nl).trim());
        pending = pending.slice(nl + 1);
        nl = pending.indexOf('\n');
      }
    } catch {
      try {
        activeReader.releaseLock();
      } catch {
        /* already released */
      }
      activeReader = undefined;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

/** Stream lines until the port ends. A drop during handshake is a reboot, not
 *  a failed identity check — the opener decides whether to retry. */
async function pump(candidate: SerialPort): Promise<void> {
  try {
    await readAvailable(candidate);
  } catch {
    /* unplugged or rebooted mid-read */
  }
  if (!reading) return;
  streamEnded?.();
}

async function openCandidate(candidate: SerialPort): Promise<boolean> {
  try {
    await candidate.open({ baudRate: 115200 });
    return true;
  } catch {
    /* already open in this origin, or held by another tab */
  }
  try {
    await candidate.close();
  } catch {
    /* was not ours */
  }
  try {
    await candidate.open({ baudRate: 115200 });
    return true;
  } catch {
    return false;
  }
}

type HandshakeResult = 'linked' | 'drop' | 'timeout' | 'busy';

async function openAndWait(candidate: SerialPort): Promise<HandshakeResult> {
  if (!(await openCandidate(candidate))) return 'busy';
  try {
    // Release reset/boot after the host has opened. Too late to prevent the
    // first CDC reset, but it keeps the board out of the bootloader.
    await candidate.setSignals({ dataTerminalReady: false, requestToSend: false });
  } catch {
    /* not every platform exposes setSignals */
  }

  port = candidate;
  writer = candidate.writable?.getWriter();
  activeReader = candidate.readable?.getReader();
  if (!writer || !activeReader) {
    await teardown();
    return 'busy';
  }
  reading = true;
  pumpDone = pump(candidate);

  return await new Promise<HandshakeResult>((resolve) => {
    const hello = setInterval(() => void send('LSK HELLO'), 1200);
    const firstHello = setTimeout(() => void send('LSK HELLO'), HELLO_AFTER_OPEN_MS);
    const timer = setTimeout(() => finish('timeout'), HANDSHAKE_TIMEOUT_MS);
    const finish = (result: HandshakeResult) => {
      clearInterval(hello);
      clearTimeout(firstHello);
      clearTimeout(timer);
      identified = undefined;
      streamEnded = undefined;
      resolve(result);
    };
    identified = () => finish('linked');
    streamEnded = () => finish('drop');
  });
}

/** Open one port and ask it to identify. Survives the ESP32-S3 USB reboot
 *  that almost always happens on the first open. */
async function attemptPort(candidate: SerialPort): Promise<boolean> {
  for (let attempt = 0; attempt < HANDSHAKE_MAX_ATTEMPTS; attempt++) {
    if (state.status === 'off') return false;
    const result = await openAndWait(candidate);
    if (result === 'linked') return true;
    await teardown();
    if (state.status === 'off') return false;
    const action = nextSerialAction({
      event: result === 'timeout' ? 'timeout' : 'stream-drop',
      deliberate: false,
      attempt,
    });
    if (action !== 'retry') return false;
    set({ status: 'connecting', error: undefined });
    await new Promise((r) => setTimeout(r, REENUMERATE_WAIT_MS));
  }
  return false;
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
  if (state.status === 'connecting' || state.status === 'linked') {
    await disconnectDeviceLink();
  }
  set({ status: 'connecting', error: undefined, canPick: undefined, lastRx: undefined });

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
      error:
        'that port never answered — close every other Lilyshark tab, leave the T-Deck plugged in, and retry. Opening USB reboots the board; wait until the header says T-DECK LINKED.',
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
  // Deliberate CONNECT owns the port. An unprompted retry here used to steal
  // the CDC handle, fail the reboot handshake, and snap the header back to
  // CONNECT with no error.
  return;
}

export async function sendDeviceLine(line: string): Promise<void> {
  if (state.status !== 'linked') {
    throw new Error('T-Deck is not linked');
  }
  await send(line);
  if (!line.startsWith('LSK TX ')) return;
  await new Promise<void>((resolve, reject) => {
    pendingTx = {
      resolve,
      reject,
      timer: setTimeout(() => {
        pendingTx = undefined;
        reject(new Error('radio did not confirm TX'));
      }, 8000),
    };
  });
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

// Dev only: companion to window.__lilysharkCapture (see captureSession.ts) —
// lets a browser test feed the app's own parser the exact lines the firmware
// prints, so the whole capture UI can be exercised without a radio.
declare global {
  interface Window {
    __lilysharkParseLsk?: typeof parseLskLine;
  }
}
if (typeof window !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
  window.__lilysharkParseLsk = parseLskLine;
}
