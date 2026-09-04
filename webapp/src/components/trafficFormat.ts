/**
 * The two readouts the TRAFFIC table and its detail pane both render.
 *
 * They live here rather than in either component because the row and the
 * detail for the same frame must never disagree about what its frequency or
 * its CRC says.
 */
import type { LscapFrame } from '../lib/lscap';

export const fmtFreq = (hz: number) =>
  hz >= 1_000_000 ? `${(hz / 1_000_000).toFixed(3)} MHz` : `${(hz / 1000).toFixed(1)} kHz`;

export const crcClass = (c: LscapFrame['crc']) =>
  c === 'valid' ? 'ok' : c === 'invalid' ? 'err' : 'dim';
