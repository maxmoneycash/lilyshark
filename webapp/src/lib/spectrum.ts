/**
 * The pure half of the SPECTRUM screen.
 *
 * While sweeping, the firmware steps the SX1262 across a band and prints one
 * "LSK S" line per pass: {"f0":hz,"f1":hz,"bins":N,"db":[ints]} — measured
 * power per bin in dBm, left to right from f0 to f1. Everything here is math
 * on those numbers (parsing, the waterfall ring, peak hold, the dBm→intensity
 * mapping, axis ticks), free of the DOM so node:test can cover it; the canvas
 * drawing stays in Spectrum.tsx.
 */

export interface SpectrumSweep {
  /** Band edges in Hz: the first bin starts at f0Hz, the last ends at f1Hz. */
  f0Hz: number;
  f1Hz: number;
  /** Measured power per bin, dBm. */
  db: number[];
  atMs: number;
}

/** Waterfall rows kept. At a couple of passes per second this is a few
 *  minutes of history, and the full redraw stays well under a frame. */
export const SPECTRUM_HISTORY_LIMIT = 240;

/**
 * Undefined unless the body is a complete sweep. The bin count is required to
 * match the array: a serial line clipped mid-array still parses as JSON often
 * enough, and plotting the surviving half stretched across the whole band
 * would look like a real measurement.
 */
export function parseSpectrumBody(
  body: Record<string, unknown>,
  nowMs = Date.now(),
): SpectrumSweep | undefined {
  const { f0, f1, bins, db } = body;
  if (typeof f0 !== 'number' || !Number.isFinite(f0) || f0 <= 0) return undefined;
  if (typeof f1 !== 'number' || !Number.isFinite(f1) || f1 <= f0) return undefined;
  if (!Array.isArray(db) || db.length === 0) return undefined;
  if (typeof bins !== 'number' || bins !== db.length) return undefined;
  const out: number[] = [];
  for (const v of db) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    out.push(v);
  }
  return { f0Hz: f0, f1Hz: f1, db: out, atMs: nowMs };
}

/**
 * Ring append for the waterfall. A sweep with a different span or bin count is
 * a retune: rows from the old band would sit under the new one with the wrong
 * frequencies, so the history restarts instead of mixing them.
 */
export function appendSpectrumSweep(
  sweeps: SpectrumSweep[],
  sweep: SpectrumSweep,
  limit = SPECTRUM_HISTORY_LIMIT,
): SpectrumSweep[] {
  const last = sweeps[sweeps.length - 1];
  const retuned =
    last !== undefined &&
    (last.f0Hz !== sweep.f0Hz ||
      last.f1Hz !== sweep.f1Hz ||
      last.db.length !== sweep.db.length);
  const next = retuned
    ? []
    : sweeps.length >= limit
      ? sweeps.slice(sweeps.length - limit + 1)
      : sweeps.slice();
  next.push(sweep);
  return next;
}

/** Element-wise max, so a burst stays marked after it ends. A bin-count
 *  change means a retune and the trace restarts from the new sweep. */
export function updatePeakHold(prev: number[] | undefined, db: number[]): number[] {
  if (!prev || prev.length !== db.length) return db.slice();
  const next = new Array<number>(db.length);
  for (let i = 0; i < db.length; i++) next[i] = Math.max(prev[i], db[i]);
  return next;
}

/** Fallback color range before any sweep arrives: LoRa noise floor to a
 *  strong nearby transmitter. */
export const DEFAULT_DB_RANGE = { minDb: -130, maxDb: -60 };

/** At least this many dB between black and full brightness, so a flat noise
 *  floor renders as a quiet band instead of amplified static. */
export const MIN_DB_SPAN = 20;

/** Color range from the data on screen, floor-to-ceiling with the span floor
 *  applied upward — the noise floor stays pinned at dark. */
export function dbRange(sweeps: SpectrumSweep[]): { minDb: number; maxDb: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const s of sweeps) {
    for (const v of s.db) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === Infinity) return { ...DEFAULT_DB_RANGE };
  const minDb = Math.floor(min);
  const maxDb = Math.max(Math.ceil(max), minDb + MIN_DB_SPAN);
  return { minDb, maxDb };
}

/** 0 at minDb and below, 1 at maxDb and above. */
export function powerToUnit(db: number, minDb: number, maxDb: number): number {
  if (maxDb <= minDb) return 0;
  const u = (db - minDb) / (maxDb - minDb);
  return u < 0 ? 0 : u > 1 ? 1 : u;
}

/** Center frequency of bin i out of `bins` spanning f0..f1. */
export function binCenterHz(f0Hz: number, f1Hz: number, bins: number, i: number): number {
  return f0Hz + ((i + 0.5) * (f1Hz - f0Hz)) / bins;
}

/** Index of the loudest bin, -1 when there is nothing. */
export function peakBin(db: number[]): number {
  let best = -1;
  let bestDb = -Infinity;
  for (let i = 0; i < db.length; i++) {
    if (db[i] > bestDb) {
      bestDb = db[i];
      best = i;
    }
  }
  return best;
}

/** Evenly spaced axis labels, ends included. `frac` is the 0..1 position. */
export function freqTicks(
  f0Hz: number,
  f1Hz: number,
  count = 5,
): { frac: number; hz: number }[] {
  if (count < 2) return [{ frac: 0, hz: f0Hz }];
  const out: { frac: number; hz: number }[] = [];
  for (let i = 0; i < count; i++) {
    const frac = i / (count - 1);
    out.push({ frac, hz: f0Hz + frac * (f1Hz - f0Hz) });
  }
  return out;
}

/** 906875000 → "906.875 MHz". Same shape as fmtFreq in mesh/fmt.ts, which
 *  takes kHz; sweeps arrive in Hz. */
export function fmtMHz(hz: number, digits = 3): string {
  return `${(hz / 1e6).toFixed(digits)} MHz`;
}

/** "#rrggbb" (any longer suffix ignored) → channels for canvas ImageData. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: Number.parseInt(h.slice(0, 2), 16) || 0,
    g: Number.parseInt(h.slice(2, 4), 16) || 0,
    b: Number.parseInt(h.slice(4, 6), 16) || 0,
  };
}
