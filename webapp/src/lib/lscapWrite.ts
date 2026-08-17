/**
 * Build a `.lscap` capture in the browser from frames the device streamed over
 * the USB link.
 *
 * The firmware writes captures to microSD itself; this is the same format
 * assembled on the other side of the cable, so a session recorded in the web
 * app opens in the same analyzer — and in Wireshark once converted — as one
 * pulled off the card. The byte layout mirrors parseLscap() in lscap.ts field
 * for field; lscapWrite.test.ts round-trips a capture through both to keep
 * them from drifting.
 */
import {
  LSCAP_FILE_HEADER_SIZE,
  LSCAP_FILE_MAGIC,
  LSCAP_RECORD_HEADER_SIZE,
  LSCAP_RECORD_MAGIC,
} from './lscap';
import type { RawFrameFields } from './deviceLink';

/** Microsecond timestamps, matching the firmware's monotonic clock. */
export const LSCAP_TICKS_PER_SECOND = 1_000_000;

const MAJOR = 1;
/** Minor 1 is where the record's metadata byte carries the synthetic flag. */
const MINOR = 1;

function writeMagic(view: DataView, offset: number, magic: string): void {
  for (let i = 0; i < 4; i++) view.setUint8(offset + i, magic.charCodeAt(i));
}

/** Total bytes a capture of these frames will occupy. */
export function lscapByteLength(frames: RawFrameFields[]): number {
  let n = LSCAP_FILE_HEADER_SIZE;
  for (const f of frames) n += LSCAP_RECORD_HEADER_SIZE + f.bytes.length;
  return n;
}

export function buildLscap(frames: RawFrameFields[]): Uint8Array {
  const out = new Uint8Array(lscapByteLength(frames));
  const view = new DataView(out.buffer);

  writeMagic(view, 0, LSCAP_FILE_MAGIC);
  view.setUint16(4, MAJOR, true);
  view.setUint16(6, MINOR, true);
  view.setUint16(8, LSCAP_FILE_HEADER_SIZE, true);
  view.setUint16(10, LSCAP_RECORD_HEADER_SIZE, true);
  view.setUint32(12, 0, true); // file flags
  view.setUint32(16, LSCAP_TICKS_PER_SECOND, true);
  view.setUint32(20, 0, true); // reserved

  let off = LSCAP_FILE_HEADER_SIZE;
  for (const f of frames) {
    const captured = f.bytes.length;
    // The device reports the on-air length; a frame longer than what it kept
    // is truncated, and the reader derives that from the two lengths.
    const original = Math.max(f.originalLength, captured);

    writeMagic(view, off, LSCAP_RECORD_MAGIC);
    view.setUint32(off + 4, 0, true); // reserved
    view.setUint16(off + 8, captured, true);
    view.setUint16(off + 10, Math.min(original, 0xffff), true);
    view.setBigUint64(off + 12, BigInt(f.seq), true);
    view.setBigUint64(off + 20, f.timestampUs, true);
    view.setUint32(off + 28, f.presentFields >>> 0, true);
    view.setUint32(off + 32, f.centerFrequencyHz >>> 0, true);
    view.setUint32(off + 36, f.bandwidthHz >>> 0, true);
    view.setUint32(off + 40, f.bitRateBps >>> 0, true);
    view.setUint32(off + 44, f.frequencyDeviationHz >>> 0, true);
    view.setUint32(off + 48, f.airtimeUs >>> 0, true);
    view.setInt32(off + 52, f.frequencyErrorHz | 0, true);
    // RSSI and SNR stay in the firmware's x10 fixed point, which is how the
    // format stores them; parseLscap divides by 10 on the way back out.
    view.setInt16(off + 56, clampI16(f.rssiX10), true);
    view.setInt16(off + 58, clampI16(f.snrX10), true);
    view.setUint16(off + 60, f.preambleSymbols & 0xffff, true);
    view.setUint16(off + 62, f.syncWord & 0xffff, true);
    view.setUint16(off + 64, f.profileId & 0xffff, true);
    view.setInt16(off + 66, clampI16(f.radioStatus), true);
    view.setInt8(off + 68, Math.max(-128, Math.min(127, f.txPowerDbm | 0)));
    view.setUint8(off + 69, f.spreadingFactor & 0xff);
    view.setUint8(off + 70, f.codingRateDenominator & 0xff);
    view.setUint8(off + 71, f.channelIndex & 0xff);
    view.setUint8(off + 72, f.radioIndex & 0xff);
    view.setUint8(off + 73, f.modulation & 0xff);
    view.setUint8(off + 74, f.direction & 0xff);
    view.setUint8(off + 75, f.crc & 0xff);
    view.setUint8(off + 76, f.metadataFlags & 0xff);
    view.setUint8(off + 77, 0);
    view.setUint16(off + 78, 0, true); // reserved

    out.set(f.bytes, off + LSCAP_RECORD_HEADER_SIZE);
    off += LSCAP_RECORD_HEADER_SIZE + captured;
  }

  return out;
}

function clampI16(v: number): number {
  const n = Math.round(Number.isFinite(v) ? v : 0);
  return Math.max(-32768, Math.min(32767, n));
}
