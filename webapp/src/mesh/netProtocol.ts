/**
 * The net bridge's wire protocol, kept pure so tests can hold it still.
 *
 * An envelope carries what travelled on the air — the raw Meshtastic frame as
 * hex, still channel-encrypted — plus the decoded summary the sending
 * firmware already produced, and the publisher's ephemeral client id so a
 * broker echo of our own message drops on sight. Loop prevention lives in
 * `shouldPublish`: frames only ever enter the room from a device link, never
 * from the room itself.
 */
import type { HeardFrame } from '../lib/deviceLink';

export const NET_TOPIC_PREFIX = 'lilyshark/mesh/v1';
/** Serial-echo metadata bit the firmware sets on frames it injected. */
export const NET_ORIGIN_FLAG = 1 << 3;
/** The firmware refuses frames past 255 bytes; the room never ships more. */
export const NET_MAX_RAW_HEX = 510;

export interface NetEnvelope {
  v: 1;
  from: string;
  at: number;
  frame: {
    src: number;
    dst: number;
    proto: string;
    port: number;
    hops?: number;
    kind: string;
    name?: string;
    short?: string;
    text?: string;
    lat?: number;
    lon?: number;
  };
  raw?: string;
}

export function netTopic(room: string): string {
  // Rooms are user text; keep them from escaping the namespace.
  return `${NET_TOPIC_PREFIX}/${room.replace(/[^a-zA-Z0-9_-]/g, '_')}/frames`;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Whether a frame heard from the device may be published to the room. */
export function shouldPublish(frame: HeardFrame): boolean {
  if (frame.sim) return false; // simulate-mode traffic never leaves the bench
  if (frame.raw && (frame.raw.metadataFlags & NET_ORIGIN_FLAG) !== 0) return false;
  return true;
}

export function encodeEnvelope(frame: HeardFrame, from: string, at: number): NetEnvelope {
  return {
    v: 1,
    from,
    at,
    frame: {
      src: frame.src,
      dst: frame.dst,
      proto: frame.proto,
      port: frame.port,
      hops: frame.hops,
      kind: frame.kind,
      name: frame.name,
      short: frame.short,
      text: frame.text,
      lat: frame.lat,
      lon: frame.lon,
    },
    raw: frame.raw ? bytesToHex(frame.raw.bytes) : undefined,
  };
}

/** Parse and validate a received payload; undefined for anything malformed,
 *  oversized, or our own echo. Noise must never become a node. */
export function decodeEnvelope(payload: string, selfId: string): NetEnvelope | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  const env = parsed as Partial<NetEnvelope>;
  if (env.v !== 1 || typeof env.from !== 'string' || env.from === selfId) return undefined;
  const frame = env.frame;
  if (!frame || typeof frame.src !== 'number' || typeof frame.dst !== 'number') {
    return undefined;
  }
  if (frame.lat !== undefined && typeof frame.lat !== 'number') return undefined;
  if (frame.lon !== undefined && typeof frame.lon !== 'number') return undefined;
  if (frame.text !== undefined && typeof frame.text !== 'string') return undefined;
  if (env.raw !== undefined) {
    if (typeof env.raw !== 'string' || /[^0-9a-fA-F]/.test(env.raw)) return undefined;
    if (env.raw.length === 0 || env.raw.length % 2 !== 0) return undefined;
    if (env.raw.length > NET_MAX_RAW_HEX) return undefined;
  }
  return env as NetEnvelope;
}
