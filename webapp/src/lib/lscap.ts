/**
 * Lilyshark native capture (.lscap) reader.
 *
 * Mirrors the firmware writer in src/export/lilyshark_capture.cpp exactly.
 * All integers are little-endian.
 *
 *   File header  — 24 bytes, magic "LSCP"
 *   Record header — 80 bytes, magic "LSFR", followed by `capturedLength` frame bytes
 *
 * Keep the offsets below in step with kLilysharkCaptureFileHeaderSize /
 * kLilysharkCaptureRecordHeaderSize in include/lilyshark/export/lilyshark_capture.h.
 */

export const LSCAP_FILE_MAGIC = 'LSCP';
export const LSCAP_RECORD_MAGIC = 'LSFR';
export const LSCAP_FILE_HEADER_SIZE = 24;
export const LSCAP_RECORD_HEADER_SIZE = 80;

export type Modulation = 'unknown' | 'lora' | 'fsk';
export type FrameDirection = 'unknown' | 'rx' | 'tx';
export type CrcStatus = 'unknown' | 'absent' | 'valid' | 'invalid';

const MODULATION: Modulation[] = ['unknown', 'lora', 'fsk'];
const DIRECTION: FrameDirection[] = ['unknown', 'rx', 'tx'];
const CRC: CrcStatus[] = ['unknown', 'absent', 'valid', 'invalid'];

/** Bit positions of RfField* in the firmware's present_fields mask. */
export const RF_FIELD = {
  timestamp: 1 << 0,
  frequency: 1 << 1,
  bandwidth: 1 << 2,
  airtime: 1 << 3,
  frequencyError: 1 << 4,
  rssi: 1 << 5,
  snr: 1 << 6,
  txPower: 1 << 7,
  preamble: 1 << 8,
  syncWord: 1 << 9,
  profile: 1 << 10,
  spreadingFactor: 1 << 11,
  codingRate: 1 << 12,
  channel: 1 << 13,
  radioStatus: 1 << 14,
  bitRate: 1 << 15,
  frequencyDeviation: 1 << 16,
} as const;

/** Bit positions in the record header's metadata_flags byte. */
export const LSCAP_METADATA_FLAG = {
  implicitHeader: 1 << 0,
  invertedIq: 1 << 1,
  synthetic: 1 << 2,
} as const;

export interface LscapFileHeader {
  majorVersion: number;
  minorVersion: number;
  fileHeaderSize: number;
  recordHeaderSize: number;
  fileFlags: number;
  ticksPerSecond: number;
}

export interface LscapFrame {
  sequence: bigint;
  timestampUs: bigint;
  capturedLength: number;
  originalLength: number;
  /** True when the radio truncated the frame. */
  truncated: boolean;
  presentFields: number;
  centerFrequencyHz: number;
  bandwidthHz: number;
  bitRateBps: number;
  frequencyDeviationHz: number;
  airtimeUs: number;
  frequencyErrorHz: number;
  /** dBm — already divided out of the firmware's x10 fixed point. */
  rssiDbm: number;
  snrDb: number;
  preambleSymbols: number;
  syncWord: number;
  profileId: number;
  radioStatus: number;
  txPowerDbm: number;
  spreadingFactor: number;
  codingRateDenominator: number;
  channelIndex: number;
  radioIndex: number;
  modulation: Modulation;
  direction: FrameDirection;
  crc: CrcStatus;
  metadataFlags: number;
  /** True when the frame was generated rather than received over the air. */
  synthetic: boolean;
  bytes: Uint8Array;
}

export interface LscapCapture {
  header: LscapFileHeader;
  frames: LscapFrame[];
  /** Bytes that could not be parsed as a complete record, if any. */
  trailingBytes: number;
}

function magicAt(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

export class LscapParseError extends Error {}

/**
 * Parse a .lscap buffer. Throws LscapParseError when the file header is not a
 * Lilyshark capture; a truncated final record is reported via `trailingBytes`
 * rather than throwing, so partially-flushed captures still open.
 */
export function parseLscap(buffer: ArrayBuffer): LscapCapture {
  const view = new DataView(buffer);

  if (buffer.byteLength < LSCAP_FILE_HEADER_SIZE) {
    throw new LscapParseError('File is shorter than an .lscap header');
  }
  if (magicAt(view, 0) !== LSCAP_FILE_MAGIC) {
    throw new LscapParseError(`Not an .lscap capture (magic was "${magicAt(view, 0)}")`);
  }

  const header: LscapFileHeader = {
    majorVersion: view.getUint16(4, true),
    minorVersion: view.getUint16(6, true),
    fileHeaderSize: view.getUint16(8, true),
    recordHeaderSize: view.getUint16(10, true),
    fileFlags: view.getUint32(12, true),
    ticksPerSecond: view.getUint32(16, true),
  };

  if (header.majorVersion !== 1) {
    throw new LscapParseError(`Unsupported .lscap major version ${header.majorVersion}`);
  }

  const frames: LscapFrame[] = [];
  const syntheticSupported = header.minorVersion >= 1;
  // Honour the sizes declared in the file rather than the compile-time constants,
  // so a forward-compatible writer with a larger header still reads correctly.
  let offset = header.fileHeaderSize || LSCAP_FILE_HEADER_SIZE;
  const recordHeaderSize = header.recordHeaderSize || LSCAP_RECORD_HEADER_SIZE;

  while (offset + recordHeaderSize <= buffer.byteLength) {
    if (magicAt(view, offset) !== LSCAP_RECORD_MAGIC) {
      break;
    }
    const capturedLength = view.getUint16(offset + 8, true);
    const originalLength = view.getUint16(offset + 10, true);
    const payloadStart = offset + recordHeaderSize;
    if (payloadStart + capturedLength > buffer.byteLength) {
      break; // final record was cut off mid-flush
    }
    const metadataFlags = view.getUint8(offset + 76);

    frames.push({
      sequence: view.getBigUint64(offset + 12, true),
      timestampUs: view.getBigUint64(offset + 20, true),
      capturedLength,
      originalLength,
      truncated: originalLength > capturedLength,
      presentFields: view.getUint32(offset + 28, true),
      centerFrequencyHz: view.getUint32(offset + 32, true),
      bandwidthHz: view.getUint32(offset + 36, true),
      bitRateBps: view.getUint32(offset + 40, true),
      frequencyDeviationHz: view.getUint32(offset + 44, true),
      airtimeUs: view.getUint32(offset + 48, true),
      frequencyErrorHz: view.getInt32(offset + 52, true),
      rssiDbm: view.getInt16(offset + 56, true) / 10,
      snrDb: view.getInt16(offset + 58, true) / 10,
      preambleSymbols: view.getUint16(offset + 60, true),
      syncWord: view.getUint16(offset + 62, true),
      profileId: view.getUint16(offset + 64, true),
      // radio_status is std::int16_t in raw_frame.h — the firmware casts it to
      // uint16 only to write it, so it must be read back signed.
      radioStatus: view.getInt16(offset + 66, true),
      txPowerDbm: view.getInt8(offset + 68),
      spreadingFactor: view.getUint8(offset + 69),
      codingRateDenominator: view.getUint8(offset + 70),
      channelIndex: view.getUint8(offset + 71),
      radioIndex: view.getUint8(offset + 72),
      modulation: MODULATION[view.getUint8(offset + 73)] ?? 'unknown',
      direction: DIRECTION[view.getUint8(offset + 74)] ?? 'unknown',
      crc: CRC[view.getUint8(offset + 75)] ?? 'unknown',
      metadataFlags,
      synthetic:
        syntheticSupported && (metadataFlags & LSCAP_METADATA_FLAG.synthetic) !== 0,
      bytes: new Uint8Array(buffer, payloadStart, capturedLength),
    });

    offset = payloadStart + capturedLength;
  }

  return { header, frames, trailingBytes: buffer.byteLength - offset };
}

export function hasField(frame: LscapFrame, field: number): boolean {
  return (frame.presentFields & field) !== 0;
}

/** Wireshark-style hex + ASCII dump of a frame's bytes. */
export function hexDump(bytes: Uint8Array, bytesPerRow = 16): string {
  const rows: string[] = [];
  for (let i = 0; i < bytes.length; i += bytesPerRow) {
    const slice = bytes.subarray(i, i + bytesPerRow);
    const hex = Array.from(slice, (b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(slice, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    rows.push(`${i.toString(16).padStart(6, '0')}  ${hex.padEnd(bytesPerRow * 3 - 1)}  ${ascii}`);
  }
  return rows.join('\n');
}

/** Aggregate stats for a capture — drives the summary strip in the Traffic view. */
export function summarize(frames: LscapFrame[]) {
  if (frames.length === 0) {
    return {
      frames: 0, bytes: 0, crcValid: 0, crcInvalid: 0,
      bestSnrDb: null as number | null, medianRssiDbm: null as number | null,
      airtimeMs: 0, durationSec: 0, framesPerMinute: 0,
    };
  }
  const rssi = frames.map((f) => f.rssiDbm).sort((a, b) => a - b);
  const first = frames[0].timestampUs;
  const last = frames[frames.length - 1].timestampUs;
  const durationSec = Number(last - first) / 1_000_000;
  return {
    frames: frames.length,
    bytes: frames.reduce((n, f) => n + f.capturedLength, 0),
    crcValid: frames.filter((f) => f.crc === 'valid').length,
    crcInvalid: frames.filter((f) => f.crc === 'invalid').length,
    bestSnrDb: Math.max(...frames.map((f) => f.snrDb)),
    medianRssiDbm: rssi[Math.floor(rssi.length / 2)],
    airtimeMs: frames.reduce((n, f) => n + f.airtimeUs, 0) / 1000,
    durationSec,
    framesPerMinute: durationSec > 0 ? (frames.length / durationSec) * 60 : 0,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Shelby off-grid pointer
 *
 * Mirrors include/lilyshark/shelby/shelby_pointer.h exactly — 82 bytes,
 * little-endian, magic "SHLB". A LoRa node has no IP path, so the mesh carries
 * this pointer and a connected node moves the bytes to or from Shelby.
 * ──────────────────────────────────────────────────────────────────────────── */

export const SHELBY_POINTER_MAGIC = 'SHLB';
export const SHELBY_POINTER_SIZE = 82;
export const SHELBY_POINTER_VERSION = 1;

export const SHELBY_FLAG = {
  encrypted: 1 << 0,
  chunked: 1 << 1,
  capture: 1 << 2,
} as const;

export interface ShelbyPointer {
  version: number;
  flags: number;
  /** 32-byte blob commitment, 0x-prefixed hex. */
  commitment: string;
  /** 32-byte owner account address, 0x-prefixed hex. */
  owner: string;
  sizeBytes: number;
  expiresAtUnix: number;
  chunkIndex: number;
  chunkCount: number;
  encrypted: boolean;
  chunked: boolean;
  capture: boolean;
}

function hexFrom(view: DataView, offset: number, length: number): string {
  let out = '0x';
  for (let i = 0; i < length; i++) out += view.getUint8(offset + i).toString(16).padStart(2, '0');
  return out;
}

/**
 * Decode a Shelby pointer at `offset`. Returns null unless the magic, version,
 * and chunk fields are all self-consistent — the same checks the firmware makes,
 * so the two implementations accept exactly the same bytes.
 */
export function decodeShelbyPointer(bytes: Uint8Array, offset = 0): ShelbyPointer | null {
  if (offset + SHELBY_POINTER_SIZE > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, SHELBY_POINTER_SIZE);

  if (String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
      !== SHELBY_POINTER_MAGIC) return null;
  if (view.getUint8(4) !== SHELBY_POINTER_VERSION) return null;

  const flags = view.getUint8(5);
  const chunkIndex = view.getUint16(78, true);
  const chunkCount = view.getUint16(80, true);
  if (chunkCount === 0 || chunkIndex >= chunkCount) return null;
  if (((flags & SHELBY_FLAG.chunked) !== 0) !== (chunkCount > 1)) return null;

  return {
    version: SHELBY_POINTER_VERSION,
    flags,
    commitment: hexFrom(view, 6, 32),
    owner: hexFrom(view, 38, 32),
    sizeBytes: view.getUint32(70, true),
    expiresAtUnix: view.getUint32(74, true),
    chunkIndex,
    chunkCount,
    encrypted: (flags & SHELBY_FLAG.encrypted) !== 0,
    chunked: (flags & SHELBY_FLAG.chunked) !== 0,
    capture: (flags & SHELBY_FLAG.capture) !== 0,
  };
}

/** Scan a captured frame for an embedded Shelby pointer, at any offset. */
export function findShelbyPointer(bytes: Uint8Array): { offset: number; pointer: ShelbyPointer } | null {
  for (let i = 0; i + SHELBY_POINTER_SIZE <= bytes.length; i++) {
    if (bytes[i] !== 0x53 || bytes[i + 1] !== 0x48 || bytes[i + 2] !== 0x4c || bytes[i + 3] !== 0x42) continue;
    const pointer = decodeShelbyPointer(bytes, i);
    if (pointer) return { offset: i, pointer };
  }
  return null;
}
