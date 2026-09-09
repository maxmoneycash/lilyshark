/** Live T-Deck camera / light knobs. DialKit writes these in dev only. */
export type TDeckTune = {
  halfHeight: number;
  pan: number;
  exposure: number;
  envIntensity: number;
  breathe: number;
};

export const TDECK_TUNE_DEFAULTS: TDeckTune = {
  halfHeight: 0.082,
  pan: 0,
  exposure: 1,
  envIntensity: 1,
  breathe: 0.012,
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
    merged.exposure === tune.exposure &&
    merged.envIntensity === tune.envIntensity &&
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
