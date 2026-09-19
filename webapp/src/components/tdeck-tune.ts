import { SPIN_RATE } from './tdeck-pose';

/** Live T-Deck camera / light knobs. DialKit writes these in dev only. */
export type TDeckTune = {
  halfHeight: number;
  pan: number;
  exposure: number;
  envIntensity: number;
  /** Radians per second of the idle turn; 0 holds the device still. */
  spin: number;
};

export const TDECK_TUNE_DEFAULTS: TDeckTune = {
  halfHeight: 0.07,
  pan: 0,
  exposure: 1.14,
  envIntensity: 1.12,
  spin: SPIN_RATE,
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
    merged.spin === tune.spin
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
