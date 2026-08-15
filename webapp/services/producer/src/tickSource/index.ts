import fs from "node:fs";
import type { NormalizedCandle } from "@shelby-cash/candle-primitives";
import { createRandomTickGenerator } from "./random.ts";

interface CsvSourceOptions {
  csvPath: string;
  intervalMs: number;
}

export type TickSource = AsyncGenerator<NormalizedCandle>;

export async function* createTickSource(options: {
  mode: "random" | "csv";
  intervalMs: number;
  csvPath?: string;
}): TickSource {
  if (options.mode === "random") {
    const generator = createRandomTickGenerator({
      intervalMs: options.intervalMs,
    });
    while (true) {
      yield generator();
      await wait(options.intervalMs);
    }
  }

  if (!options.csvPath) {
    throw new Error("CSV path required for csv mode");
  }

  yield* streamCsvCandles({
    csvPath: options.csvPath,
    intervalMs: options.intervalMs,
  });
}

async function* streamCsvCandles({
  csvPath,
  intervalMs,
}: CsvSourceOptions): TickSource {
  const content = await fs.promises.readFile(csvPath, "utf-8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  let lastTimestamp = Date.now();

  for (const line of lines) {
    const [timestampStr, openStr, highStr, lowStr, closeStr, volumeStr] =
      line.split(",");
    const parsedTimestamp = Number(timestampStr);
    const timestampMs = Number.isFinite(parsedTimestamp)
      ? parsedTimestamp
      : lastTimestamp + intervalMs;

    const candle: NormalizedCandle = {
      timestampMs,
      open: Number(openStr),
      high: Number(highStr),
      low: Number(lowStr),
      close: Number(closeStr),
      volume: Number(volumeStr),
    };
    lastTimestamp = candle.timestampMs;
    yield candle;
    await wait(intervalMs);
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
