import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSegmentPath,
  createInitialManifest,
  latestPath,
  manifestPath,
  type NormalizedCandle,
  type ShelbyManifest,
} from "@shelby-cash/candle-primitives";
import pLimit from "p-limit";
import type { Logger } from "pino";

export type PersistenceMode = "disabled" | "local";

interface ShelbyUploaderOptions {
  mode: PersistenceMode;
  matchId: string;
  intervalMs: number;
  localRoot: string;
  segmentTargetBytes?: number;
  flushIntervalMs?: number;
  logger: Logger;
}

const DEFAULT_SEGMENT_BYTES = 64 * 1024;
const DEFAULT_FLUSH_INTERVAL_MS = 1_000;

export class ShelbyUploader {
  private readonly options: ShelbyUploaderOptions;
  private readonly limit = pLimit(1);
  private readonly manifestFile: string;
  private readonly latestFile: string;
  private manifest: ShelbyManifest;
  private buffer: NormalizedCandle[] = [];
  private bufferBytes = 0;
  private lastFlushMs = Date.now();
  private sequence = 0;
  private latestSegmentCache: string | null = null;

  constructor(options: ShelbyUploaderOptions) {
    this.options = {
      ...options,
      segmentTargetBytes: options.segmentTargetBytes ?? DEFAULT_SEGMENT_BYTES,
      flushIntervalMs: options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
    };

    this.manifest = createInitialManifest(options.matchId, options.intervalMs);
    this.manifestFile = path.join(
      options.localRoot,
      manifestPath(options.matchId),
    );
    this.latestFile = path.join(options.localRoot, latestPath(options.matchId));
  }

  async hydrateFromDisk(): Promise<void> {
    if (this.options.mode !== "local") {
      return;
    }

    try {
      const data = await fs.readFile(this.manifestFile, "utf-8");
      this.manifest = JSON.parse(data) as ShelbyManifest;
      this.sequence = this.manifest.sequence;
      if (this.manifest.latest) {
        const latestAbs = path.join(
          this.options.localRoot,
          this.manifest.latest,
        );
        this.latestSegmentCache = await fs.readFile(latestAbs, "utf-8");
      }
      this.options.logger.info(
        { sequence: this.sequence },
        "hydrated manifest from disk",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.options.logger.warn(
          { error },
          "failed to hydrate manifest, starting fresh",
        );
      }
      await this.ensureDir(path.dirname(this.manifestFile));
    }
  }

  async ingest(candles: NormalizedCandle[]): Promise<void> {
    if (this.options.mode === "disabled") {
      return;
    }

    this.buffer.push(...candles);
    for (const candle of candles) {
      const line = `${JSON.stringify(candle)}\n`;
      this.bufferBytes += Buffer.byteLength(line);
    }

    const shouldFlush =
      this.bufferBytes >=
        (this.options.segmentTargetBytes ?? DEFAULT_SEGMENT_BYTES) ||
      Date.now() - this.lastFlushMs >=
        (this.options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);

    if (shouldFlush) {
      await this.flush();
    }
  }

  async flush(force = false): Promise<void> {
    if (this.options.mode === "disabled") {
      this.buffer = [];
      this.bufferBytes = 0;
      return;
    }

    if (this.buffer.length === 0 && !force) {
      return;
    }

    const candles = this.buffer.splice(0, this.buffer.length);
    this.bufferBytes = 0;
    if (candles.length === 0) {
      return;
    }

    const ndjson = `${candles.map((candle) => JSON.stringify(candle)).join("\n")}\n`;
    this.lastFlushMs = Date.now();
    this.sequence += 1;

    const firstTimestamp = candles[0].timestampMs;
    const segmentKey = buildSegmentPath(
      this.options.matchId,
      firstTimestamp,
      this.sequence,
    );

    await this.limit(async () => {
      if (this.options.mode === "local") {
        await this.persistLocal(segmentKey, ndjson);
      }
      this.latestSegmentCache = ndjson;
      this.manifest = {
        ...this.manifest,
        latest: segmentKey,
        sequence: this.sequence,
        updatedAtMs: Date.now(),
      };
      await this.writeManifest();
      this.options.logger.debug(
        { segmentKey, sequence: this.sequence },
        "flushed shelby segment",
      );
    });
  }

  getManifestSnapshot(): ShelbyManifest {
    return this.manifest;
  }

  getLatestSegment(): string | null {
    return this.latestSegmentCache;
  }

  private async persistLocal(segmentKey: string, body: string): Promise<void> {
    const absoluteSegmentPath = path.join(this.options.localRoot, segmentKey);
    await this.ensureDir(path.dirname(absoluteSegmentPath));
    await fs.writeFile(absoluteSegmentPath, body, "utf-8");
    await this.ensureDir(path.dirname(this.latestFile));
    await fs.writeFile(this.latestFile, body, "utf-8");
  }

  private async writeManifest(): Promise<void> {
    await this.ensureDir(path.dirname(this.manifestFile));
    await fs.writeFile(
      this.manifestFile,
      JSON.stringify(this.manifest, null, 2),
      "utf-8",
    );
  }

  private async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

export function resolveLocalRoot(relativePath: string): string {
  const base = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(base, "../../", relativePath);
}
