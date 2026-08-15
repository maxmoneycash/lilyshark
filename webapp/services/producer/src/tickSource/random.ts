import type { NormalizedCandle } from "@shelby-cash/candle-primitives";

interface RandomGeneratorOptions {
  seed?: number;
  intervalMs: number;
  startPrice?: number;
  volatility?: number;
}

const mulberry32 = (seed: number): (() => number) => {
  let state = seed;

  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export function createRandomTickGenerator(options: RandomGeneratorOptions) {
  const rng = mulberry32(options.seed ?? Date.now());
  let lastTimestamp = Date.now();
  let lastClose = options.startPrice ?? 100;
  const volatility = options.volatility ?? 0.8;

  return function next(): NormalizedCandle {
    lastTimestamp += options.intervalMs;
    const timestampMs = lastTimestamp;
    const drift = (rng() - 0.5) * volatility;
    const open = lastClose;
    const close = Math.max(1, open + drift);
    const high = Math.max(open, close) + Math.abs(rng()) * (volatility / 2);
    const low = Math.min(open, close) - Math.abs(rng()) * (volatility / 2);
    const volume = 10_000 + rng() * 5_000;

    lastClose = close;

    return { timestampMs, open, high, low, close, volume };
  };
}
