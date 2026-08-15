import "dotenv/config";
import { createServer } from "node:http";
import path from "node:path";
import {
  type NormalizedCandle,
  packCandleBatch,
} from "@shelby-cash/candle-primitives";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";
import { loadConfig } from "./config.ts";
import { logger } from "./logger.ts";
import { ShelbyUploader } from "./shelbyUploader.ts";
import { createTickSource } from "./tickSource/index.ts";

async function main() {
  const config = loadConfig();
  logger.info({ config }, "producer boot");

  const server = createServer();
  const wss = new WebSocketServer({ server });
  const clients = new Set<WebSocket>();
  const uploader = new ShelbyUploader({
    mode: config.PERSISTENCE_MODE,
    matchId: config.MATCH_ID,
    intervalMs: config.INTERVAL_MS,
    localRoot: path.resolve(process.cwd(), config.LOCAL_PERSIST_ROOT),
    flushIntervalMs: config.SHELBY_FLUSH_INTERVAL_MS,
    segmentTargetBytes: config.SHELBY_SEGMENT_TARGET_BYTES,
    logger,
  });

  await uploader.hydrateFromDisk();

  process.on("SIGINT", async () => {
    logger.info("received SIGINT, flushing uploader");
    await uploader.flush(true);
    process.exit(0);
  });

  wss.on("connection", (socket) => {
    clients.add(socket);
    logger.info({ clientCount: clients.size }, "ws client connected");

    socket.on("close", () => {
      clients.delete(socket);
      logger.info({ clientCount: clients.size }, "ws client disconnected");
    });
  });

  server.on("request", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (req.method === "GET" && req.url === "/state/manifest") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(uploader.getManifestSnapshot()));
      return;
    }

    if (req.method === "GET" && req.url === "/state/latest") {
      const latest = uploader.getLatestSegment();
      if (!latest) {
        res.statusCode = 204;
        res.end();
        return;
      }
      res.setHeader("Content-Type", "application/x-ndjson");
      res.end(latest);
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  server.listen(config.WS_PORT, () => {
    logger.info({ port: config.WS_PORT }, "ws server listening");
  });

  const batch: NormalizedCandle[] = [];
  let sequence = 0;
  const tickSource = createTickSource({
    mode: config.HISTORIC_SOURCE,
    intervalMs: config.INTERVAL_MS,
    csvPath: config.CSV_PATH,
  });

  for await (const candle of tickSource) {
    batch.push(candle);
    if (batch.length >= 3) {
      const payload = batch.splice(0, batch.length);
      sequence += 1;
      broadcastBatch(payload, sequence, config.INTERVAL_MS, clients);
      void uploader.ingest(payload).catch((error) => {
        logger.error({ error }, "failed to persist candles");
      });
    }
  }
}

function broadcastBatch(
  candles: NormalizedCandle[],
  sequence: number,
  intervalMs: number,
  clients: Set<WebSocket>,
) {
  if (clients.size === 0) {
    return;
  }

  const buffer = packCandleBatch(
    {
      sequence,
      intervalMs,
      sentAtMs: Date.now(),
    },
    candles,
  );

  const payload = Buffer.from(buffer);
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}

main().catch((error) => {
  logger.error({ error }, "fatal producer error");
  process.exit(1);
});
