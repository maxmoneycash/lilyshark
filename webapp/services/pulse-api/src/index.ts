import "dotenv/config";
import express from "express";
import cors from "cors";
import { loadConfig } from "./config";
import { logger } from "./logger";
import { DataService } from "./data-service";
import { UploadService } from "./upload-service";
import { createRouter } from "./routes";

async function main() {
  const config = loadConfig();
  logger.info({ config }, "Pulse API starting");

  const app = express();
  const dataService = new DataService(config);

  // Initialize Upload Service for Shelby Share feature
  let uploadService: UploadService | undefined;
  if (config.SHELBY_PRIVATE_KEY) {
    uploadService = new UploadService(config.SHELBY_PRIVATE_KEY, config.SHELBY_API_KEY);
    if (uploadService.isAvailable()) {
      logger.info(
        { address: uploadService.getAddress(), hasApiKey: !!config.SHELBY_API_KEY },
        "Upload service initialized for Shelby Share"
      );
    } else {
      logger.warn("Upload service failed to initialize");
      uploadService = undefined;
    }
  } else {
    logger.warn("SHELBY_PRIVATE_KEY not set - Shelby Share disabled");
  }

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      logger.info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration,
        },
        "request completed",
      );
    });
    next();
  });

  // Routes
  app.use("/api", createRouter(dataService, uploadService));

  // Root endpoint
  app.get("/", (req, res) => {
    res.json({
      name: "Shelby Pulse API",
      version: "0.2.0",
      endpoints: {
        health: "/api/health",
        stats: "/api/network/stats",
        recentBlobs: "/api/blobs/recent?limit=20",
        events: "/api/events/recent?limit=100",
        providers: "/api/providers",
        economy: "/api/economy",
        share: {
          upload: "POST /api/share/upload (multipart/form-data with 'file' field)",
          info: "GET /api/share/info",
        },
      },
      shareEnabled: !!uploadService,
    });
  });

  // Error handler
  app.use(
    (
      err: Error,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      logger.error({ err, path: req.path }, "Unhandled error");
      res.status(500).json({ error: "Internal server error" });
    },
  );

  // Start server
  app.listen(config.PORT, () => {
    logger.info(
      { port: config.PORT, nodeUrl: config.APTOS_NODE_URL },
      "Pulse API listening",
    );
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    logger.info("Received SIGINT, shutting down gracefully");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    logger.info("Received SIGTERM, shutting down gracefully");
    process.exit(0);
  });
}

main().catch((error) => {
  logger.error({ err: error, message: error?.message, stack: error?.stack }, "Fatal API error");
  console.error("Fatal error:", error);
  process.exit(1);
});
