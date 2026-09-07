/**
 * Production look of the intro T-Deck, plus the live subset DialKit may
 * overlay in DEV.
 *
 * Exposure and environment intensity used to be DialKit knobs. They never
 * left their identity values (AgX 1, env 1.05), so they live here as scene
 * constants instead of leftover sliders. Framing (halfHeight, pan) and the
 * idle breathe are still knobbable in DEV because those actually move.
 */

export const TDECK_SCENE = {
  halfHeight: 0.064,
  pan: 0.3,
  exposure: 1,
  envIntensity: 1.05,
  breathe: 0.012,
  /** Ortho camera sits on this Y and looks along −Z, so the LCD faces us. */
  cameraY: -0.006,
  cameraYPhone: -0.004,
  hemiIntensity: 0.28,
  keyIntensity: 2.6,
  fillIntensity: 0.38,
  rimIntensity: 1.55,
  envMapIntensity: 1.15,
  lcdEmissive: 1,
  lcdRoughness: 0.32,
} as const;

/** Live T-Deck camera knobs. DialKit writes these in dev only. */
export type TDeckTune = {
  halfHeight: number;
  pan: number;
  breathe: number;
};

export const TDECK_TUNE_DEFAULTS: TDeckTune = {
  halfHeight: TDECK_SCENE.halfHeight,
  pan: TDECK_SCENE.pan,
  breathe: TDECK_SCENE.breathe,
};

let tune: TDeckTune = { ...TDECK_TUNE_DEFAULTS };
const listeners = new Set<() => void>();

export function getTDeckTune(): TDeckTune {
  return tune;
}

export function setTDeckTune(next: Partial<TDeckTune>): void {
  const merged = { ...tune, ...next };
  if (
    merged.halfHeight === tune.halfHeight &&
    merged.pan === tune.pan &&
    merged.breathe === tune.breathe
  ) {
    return;
  }
  tune = merged;
  for (const listener of listeners) listener();
}

export function subscribeTDeckTune(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
