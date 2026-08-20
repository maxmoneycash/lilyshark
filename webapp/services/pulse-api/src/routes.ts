import { Router } from "express";
import multer from "multer";
import fs from "fs";
import os from "os";
import path from "path";
import type { DataService } from "./data-service";
import type { UploadService } from "./upload-service";
import type { AnchorResult, AnchorService } from "./anchor-service";
import { logger } from "./logger";

// In-memory session storage for folder links
interface SessionFile {
  blobName: string;
  originalName: string;
  size: number;
  url: string;
  viewerUrl: string;
  uploadedAt: string;
  address: string;
}

interface Session {
  id: string;
  files: SessionFile[];
  createdAt: string;
}

// Store sessions in memory (they persist until server restart)
const sessions = new Map<string, Session>();

// Configure multer for disk storage (handles large files without OOM)
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      cb(null, `shelby-upload-${uniqueSuffix}${path.extname(file.originalname)}`);
    },
  }),
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024, // 2GB max
    files: 5, // Max 5 files per request
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
      "image/x-icon", "image/avif",
      "video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/x-matroska",
      "application/pdf",
    ];
    // Lilyshark captures arrive as octet-stream because no registered mimetype
    // exists for them. The extension only gates entry here; the upload handler
    // verifies the LSCP magic on the actual bytes, which a mimetype cannot do.
    const isLscap =
      path.extname(file.originalname).toLowerCase() === ".lscap" &&
      (file.mimetype === "application/octet-stream" || file.mimetype === "");
    if (allowedTypes.includes(file.mimetype) || isLscap) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  },
});

export function createRouter(
  dataService: DataService,
  uploadService?: UploadService,
  anchorService?: AnchorService
): Router {
  const router = Router();

  /**
   * GET /api/network/stats
   * Returns overall network statistics
   */
  router.get("/network/stats", async (req, res) => {
    try {
      const stats = await dataService.getNetworkStats();
      res.json(stats);
    } catch (error) {
      logger.error({ error }, "Failed to get network stats");
      res.status(500).json({ error: "Failed to fetch network statistics" });
    }
  });

  /**
   * GET /api/blobs/recent?limit=20
   * Returns recent blob data
   */
  router.get("/blobs/recent", async (req, res) => {
    try {
      const limit = Number.parseInt(req.query.limit as string) || 20;
      const blobs = await dataService.getRecentBlobs(Math.min(limit, 100));
      res.json(blobs);
    } catch (error) {
      logger.error({ error }, "Failed to get recent blobs");
      res.status(500).json({ error: "Failed to fetch recent blobs" });
    }
  });

  /**
   * GET /api/events/recent?limit=100
   * Returns recent blob events (for activity feed)
   */
  router.get("/events/recent", async (req, res) => {
    try {
      const limit = Number.parseInt(req.query.limit as string) || 100;
      const events = await dataService.getAllBlobEvents(Math.min(limit, 500));
      res.json(events);
    } catch (error) {
      logger.error({ error }, "Failed to get events");
      res.status(500).json({ error: "Failed to fetch events" });
    }
  });

  /**
   * GET /api/providers
   * Returns storage provider information
   */
  router.get("/providers", async (req, res) => {
    try {
      const providers = await dataService.getStorageProviders();
      res.json(providers);
    } catch (error) {
      logger.error({ error }, "Failed to get providers");
      res.status(500).json({ error: "Failed to fetch storage providers" });
    }
  });

  /**
   * GET /api/health
   * Health check endpoint
   */
  router.get("/health", async (req, res) => {
    try {
      const health = await dataService.healthCheck();
      res.json(health);
    } catch (error) {
      logger.error({ error }, "Health check failed");
      res.status(500).json({ status: "unhealthy", timestamp: Date.now() });
    }
  });

  /**
   * GET /api/analytics
   * Returns storage analytics - file types breakdown and top storage users
   */
  router.get("/analytics", async (req, res) => {
    try {
      const analytics = await dataService.getAnalytics();
      res.json(analytics);
    } catch (error) {
      logger.error({ error }, "Failed to get analytics data");
      res.status(500).json({ error: "Failed to fetch analytics data" });
    }
  });

  /**
   * GET /api/economy?refresh=true
   * Returns ShelbyUSD economy data (leaderboards, volume, earners, spenders)
   * Use refresh=true to bypass cache
   */
  router.get("/economy", async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === 'true';
      const economy = await dataService.getEconomyData(forceRefresh);
      res.json(economy);
    } catch (error) {
      logger.error({ error }, "Failed to get economy data");
      res.status(500).json({ error: "Failed to fetch economy data" });
    }
  });

  /**
   * GET /api/user/deposits?address=0x...&since_version=1234
   * Returns user's recent ShelbyUSD deposits with transaction hashes
   * Used for showing toast notifications with explorer links
   */
  router.get("/user/deposits", async (req, res) => {
    try {
      const address = req.query.address as string;
      const sinceVersion = req.query.since_version as string | undefined;
      const limit = Number.parseInt(req.query.limit as string) || 10;

      if (!address) {
        return res.status(400).json({ error: "address query parameter is required" });
      }

      const deposits = await dataService.getUserDeposits(address, sinceVersion, Math.min(limit, 50));
      res.json(deposits);
    } catch (error) {
      logger.error({ error }, "Failed to get user deposits");
      res.status(500).json({ error: "Failed to fetch user deposits" });
    }
  });

  /**
   * POST /api/cache/clear
   * Clear the cache (for debugging)
   */
  router.post("/cache/clear", (req, res) => {
    try {
      dataService.clearCache();
      res.json({ message: "Cache cleared successfully" });
    } catch (error) {
      logger.error({ error }, "Failed to clear cache");
      res.status(500).json({ error: "Failed to clear cache" });
    }
  });

  // ============================================
  // SYNC & DATABASE ENDPOINTS
  // ============================================

  /**
   * GET /api/sync/status
   * Get the current sync status and database stats
   */
  router.get("/sync/status", (req, res) => {
    try {
      const status = dataService.getSyncStatus();
      res.json(status);
    } catch (error) {
      logger.error({ error }, "Failed to get sync status");
      res.status(500).json({ error: "Failed to get sync status" });
    }
  });

  /**
   * POST /api/sync/force
   * Force a full resync from the blockchain
   * WARNING: This is an expensive operation - use sparingly
   */
  router.post("/sync/force", async (req, res) => {
    try {
      logger.info("Force resync requested via API");
      const count = await dataService.forceResync();
      res.json({
        message: "Full resync completed",
        activitiesSynced: count,
      });
    } catch (error) {
      logger.error({ error }, "Failed to force resync");
      res.status(500).json({ error: "Failed to force resync" });
    }
  });

  /**
   * POST /api/share/upload
   * Upload a file to Shelby (no wallet needed - server pays)
   */
  router.post("/share/upload", upload.single("file"), async (req, res) => {
    if (!uploadService || !uploadService.isAvailable()) {
      return res.status(503).json({
        error: "Upload service not available",
        message: "SHELBY_PRIVATE_KEY not configured",
      });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const tempPath = file.path;
    const cleanup = () => {
      fs.unlink(tempPath, (err) => {
        if (err) logger.warn({ err, tempPath }, "Failed to cleanup temp file");
      });
    };

    try {
      const sessionId = req.body.sessionId;

      logger.info(
        { filename: file.originalname, size: file.size, sessionId },
        "Received file for upload"
      );

      const fileBuffer = await fs.promises.readFile(tempPath);

      // A capture is evidence, so a file claiming to be one has to actually
      // be one: the .lscap header starts with the LSCP magic. Checked on the
      // bytes because the mimetype and extension are both client-supplied.
      const isCapture = path.extname(file.originalname).toLowerCase() === ".lscap";
      if (isCapture) {
        if (fileBuffer.length < 24 || fileBuffer.toString("latin1", 0, 4) !== "LSCP") {
          cleanup();
          return res.status(400).json({
            error: "Not a Lilyshark capture: the LSCP file header is missing",
          });
        }
      }

      const result = await uploadService.uploadFile(fileBuffer, file.originalname);
      cleanup();

      // A published capture must also be vouched for on-chain, or its own
      // RESOLVE trace ends at "no on-chain anchor" (task UI-002). The registry
      // write is signed server-side with the same account that paid the
      // upload; the key never reaches the browser. Anchoring failure must not
      // fail the publish — it is reported as a value so the client can render
      // an honest not-anchored state.
      let anchor: AnchorResult | undefined;
      if (isCapture) {
        if (anchorService?.isAvailable()) {
          try {
            anchor = await anchorService.anchorCapture({
              commitment: result.commitment ?? "",
              blobName: result.blobName,
              sizeBytes: result.size,
              expiresAtUnix: result.expiresAtUnix,
            });
          } catch (anchorErr) {
            // anchorCapture catches internally; this is a last-resort belt.
            anchor = {
              status: "failed",
              reason:
                anchorErr instanceof Error ? anchorErr.message : String(anchorErr),
            };
          }
        } else {
          anchor = {
            status: "skipped",
            reason: "anchoring not configured on this deployment",
          };
        }
        logger.info(
          { blobName: result.blobName, anchor },
          "Capture anchor result"
        );
      }

      // If a session ID was provided, add the file to the session
      if (sessionId) {
        if (!sessions.has(sessionId)) {
          sessions.set(sessionId, {
            id: sessionId,
            files: [],
            createdAt: new Date().toISOString(),
          });
        }
        const session = sessions.get(sessionId)!;
        session.files.push({
          blobName: result.blobName,
          originalName: file.originalname,
          size: result.size,
          url: result.url,
          viewerUrl: result.viewerUrl,
          uploadedAt: new Date().toISOString(),
          address: result.owner,
        });
        logger.info({ sessionId, fileCount: session.files.length }, "Added file to session");
      }

      res.json({
        success: true,
        url: result.url,
        viewerUrl: result.viewerUrl,
        blobName: result.blobName,
        size: result.size,
        expiresAt: result.expiresAt,
        sessionId,
        // On-chain evidence fields (captures only; both may be absent for
        // ordinary Shelby Share files).
        commitment: result.commitment ?? null,
        ...(anchor ? { anchor } : {}),
      });
    } catch (error) {
      cleanup();
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      logger.error({ errMsg, errStack }, "Failed to upload file");
      res.status(500).json({ error: errMsg });
    }
  });

  /**
   * GET /api/share/info
   * Get info about the share/upload service
   */
  router.get("/share/info", (req, res) => {
    res.json({
      available: uploadService?.isAvailable() ?? false,
      uploaderAddress: uploadService?.getAddress() ?? null,
      // Whether published captures will also be anchored on-chain (UI-002).
      anchoring: anchorService?.isAvailable() ?? false,
      maxFileSize: "2GB",
      allowedTypes: ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "avif", "mp4", "webm", "mov", "avi", "mkv", "pdf", "lscap"],
      expiration: "1 year",
    });
  });

  /**
   * GET /api/share/folder/:sessionId
   * HTML page showing all files in a session (like a Google Drive folder)
   */
  router.get("/share/folder/:sessionId", (req, res) => {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).send("Missing session ID");
      }

      const session = sessions.get(sessionId);

      if (!session || session.files.length === 0) {
        // Return a nice "folder not found" page
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Folder Not Found - Shelby Share</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      background: #FCFAF8;
      color: #1a1a1a;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .container {
      text-align: center;
      max-width: 400px;
      background: #FFDFEF;
      padding: 2rem;
      border-radius: 12px;
      border: 1px solid #FFC2E1;
    }
    .icon { color: #FF1493; font-size: 4rem; margin-bottom: 1rem; }
    h1 { color: #FF1493; margin-bottom: 0.5rem; }
    p { color: #737373; margin-bottom: 1.5rem; }
    a {
      color: #FF1493;
      text-decoration: none;
      border: 1px solid #FF1493;
      padding: 0.5rem 1rem;
      border-radius: 4px;
    }
    a:hover { background: rgba(255, 20, 147, 0.1); }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">📁</div>
    <h1>Folder Not Found</h1>
    <p>This folder doesn't exist or has expired.</p>
    <a href="/">← Back to Shelby Pulse</a>
  </div>
</body>
</html>`;
        return res.status(404).send(html);
      }

      // Format file size
      const formatSize = (bytes: number): string => {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
      };

      // Get file icon based on extension
      const getFileIcon = (filename: string): string => {
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'avif'];
        const videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv'];
        if (imageExts.includes(ext)) return '🖼️';
        if (videoExts.includes(ext)) return '🎬';
        if (ext === 'pdf') return '📄';
        return '📁';
      };

      // Generate file list HTML
      const filesHtml = session.files.map(file => `
        <div class="file-item">
          <div class="file-icon">${getFileIcon(file.originalName)}</div>
          <div class="file-info">
            <div class="file-name">${file.originalName}</div>
            <div class="file-meta">${formatSize(file.size)}</div>
          </div>
          <div class="file-actions">
            <a href="${file.viewerUrl}" target="_blank" class="btn-tab">View</a>
            <a href="${file.url}" download class="btn-tab">Download</a>
          </div>
        </div>
      `).join('');

      const totalSize = session.files.reduce((sum, f) => sum + f.size, 0);

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#FCFAF8">
  <title>Shared Folder - Shelby Share</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --root: #FCFAF8;
      --background0: #F7F1E9;
      --background1: #FFDFEF;
      --background2: #FFC2E1;
      --foreground0: #1a1a1a;
      --foreground1: #404040;
      --foreground2: #737373;
      --accent: #FF1493;
      --pink: #FF1493;
      --purple: #7D56F4;
      --green: #00C896;
      --red: #ff5f56;
      --yellow: #ffbd2e;
    }

    body {
      font-family: 'Cascadia Code', 'JetBrains Mono', 'Fira Code', 'Consolas', Monaco, monospace;
      background: var(--root);
      color: var(--foreground0);
      min-height: 100vh;
      padding: 1rem;
      display: flex;
      justify-content: center;
    }

    /* Terminal Emulator */
    .terminal-emulator {
      width: 100%;
      max-width: 700px;
      display: flex;
      flex-direction: column;
    }

    .terminal {
      background: var(--background0);
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid var(--background2);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    }

    /* Terminal Header */
    .terminal-header {
      display: flex;
      align-items: center;
      background: var(--background1);
      border-bottom: 1px solid var(--background2);
      min-height: 44px;
    }

    .dots {
      display: flex;
      gap: 0.5rem;
      padding: 0 1rem;
    }
    .dot-red { color: var(--red); }
    .dot-yellow { color: var(--yellow); }
    .dot-green { color: var(--green); }

    .header-title {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .badge {
      background: var(--background2);
      color: var(--foreground1);
      padding: 0.25rem 0.75rem;
      border-radius: 4px;
      font-size: 0.8rem;
    }

    .tab-nav {
      display: flex;
    }
    .tab-nav a, .tab-nav button {
      background: none;
      border: none;
      border-left: 1px solid var(--background2);
      color: var(--foreground2);
      cursor: pointer;
      font-family: inherit;
      font-size: 0.85rem;
      padding: 0.75rem 1rem;
      text-decoration: none;
      transition: color 0.2s, background-color 0.2s;
    }
    .tab-nav a:hover, .tab-nav button:hover {
      color: var(--foreground0);
      background: var(--background1);
    }
    .tab-nav .active {
      color: var(--accent);
      background: var(--background1);
    }

    /* Status Bar */
    .status-bar {
      padding: 0.5rem 1rem;
      background: var(--background0);
      border-bottom: 1px solid var(--background2);
      display: flex;
      gap: 1rem;
      font-size: 0.85rem;
      flex-wrap: wrap;
      align-items: center;
    }
    .badge-success {
      background: rgba(0, 200, 150, 0.15);
      color: var(--green);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
    }

    /* Terminal Content */
    .terminal-content {
      padding: 1rem;
      background: var(--background1);
      min-height: 400px;
    }

    /* Folder Section */
    .folder-section {
      margin-bottom: 1rem;
    }
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.75rem;
    }
    .section-title {
      color: var(--foreground0);
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .file-count {
      background: var(--background2);
      color: var(--foreground2);
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
    }

    /* Copy Link Section */
    .copy-section {
      background: var(--background0);
      border: 1px solid var(--background2);
      border-radius: 4px;
      padding: 0.5rem;
      margin-bottom: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .link-display {
      font-size: 0.7rem;
      color: var(--foreground2);
      word-break: break-all;
      padding: 0.25rem;
    }
    .copy-btn {
      background: none;
      border: 1px solid var(--background2);
      color: var(--foreground2);
      cursor: pointer;
      font-family: inherit;
      font-size: 0.8rem;
      padding: 0.5rem 1rem;
      text-align: center;
      transition: all 0.2s;
    }
    .copy-btn:hover {
      color: var(--accent);
      border-color: var(--accent);
    }

    /* File List */
    .file-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .file-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.6rem 0.75rem;
      background: var(--background0);
      border: 1px solid var(--background2);
      border-radius: 4px;
    }
    .file-item:hover {
      border-color: var(--accent);
    }
    .file-icon {
      font-size: 1.25rem;
      flex-shrink: 0;
    }
    .file-info {
      flex: 1;
      min-width: 0;
    }
    .file-name {
      font-size: 0.85rem;
      color: var(--foreground0);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .file-meta {
      font-size: 0.7rem;
      color: var(--foreground2);
      margin-top: 0.125rem;
    }
    .file-actions {
      display: flex;
      flex-shrink: 0;
    }
    .file-actions a {
      background: none;
      border: none;
      border-left: 1px solid var(--background2);
      color: var(--foreground2);
      cursor: pointer;
      font-family: inherit;
      font-size: 0.75rem;
      padding: 0.4rem 0.6rem;
      text-decoration: none;
      transition: color 0.2s;
    }
    .file-actions a:first-child {
      border-left: none;
    }
    .file-actions a:hover {
      color: var(--accent);
    }

    @media (max-width: 480px) {
      body { padding: 0.5rem; }
      .terminal { border-radius: 8px; }
      .dots { padding: 0 0.5rem; }
      .tab-nav a, .tab-nav button { padding: 0.6rem 0.75rem; font-size: 0.8rem; }
      .terminal-content { padding: 0.75rem; }
      .file-item { padding: 0.5rem; }
      .file-name { font-size: 0.8rem; }
    }
  </style>
</head>
<body>
  <div class="terminal-emulator">
    <div class="terminal">
      <!-- Terminal Header -->
      <div class="terminal-header">
        <div class="dots">
          <span class="dot-red">●</span>
          <span class="dot-yellow">●</span>
          <span class="dot-green">●</span>
        </div>
        <div class="header-title">
          <span class="badge">Shelby Share</span>
        </div>
        <div class="tab-nav">
          <button onclick="copyLink()"><span id="copyText">Copy Link</span></button>
          <a href="/" class="active">Home</a>
        </div>
      </div>

      <!-- Status Bar -->
      <div class="status-bar">
        <span class="badge-success">● SHARED</span>
        <span style="color: var(--foreground2)">${session.files.length} file${session.files.length !== 1 ? 's' : ''}</span>
        <span style="color: var(--foreground2)">|</span>
        <span style="color: var(--foreground2)">${formatSize(totalSize)} total</span>
      </div>

      <!-- Terminal Content -->
      <div class="terminal-content">
        <!-- Copy Section -->
        <div class="copy-section">
          <div class="link-display">${req.protocol}://${req.get('host')}${req.originalUrl}</div>
        </div>

        <!-- Files Section -->
        <div class="folder-section">
          <div class="section-header">
            <span class="section-title">📁 Files</span>
            <span class="file-count">${session.files.length}</span>
          </div>
          <div class="file-list">
            ${filesHtml}
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    function copyLink() {
      const url = '${req.protocol}://${req.get('host')}${req.originalUrl}';
      navigator.clipboard.writeText(url).then(() => {
        const btn = document.getElementById('copyText');
        if (btn) {
          btn.textContent = 'Copied!';
          setTimeout(() => btn.textContent = 'Copy Link', 2000);
        }
      });
    }
  </script>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      logger.error({ error }, "Failed to render folder page");
      res.status(500).send("Failed to load folder");
    }
  });

  /**
   * GET /api/share/view/:address/:filename
   * Proxy file from Shelby Protocol with Content-Disposition: inline
   * This allows files to be displayed in browser instead of downloaded
   */
  router.get("/share/view/:address/:filename", async (req, res) => {
    try {
      const { address, filename } = req.params;

      if (!address || !filename) {
        return res.status(400).json({ error: "address and filename are required" });
      }

      // Determine content type from file extension
      const ext = filename.split('.').pop()?.toLowerCase() || '';
      const contentTypeMap: Record<string, string> = {
        // Images
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        ico: 'image/x-icon',
        avif: 'image/avif',
        // Videos
        mp4: 'video/mp4',
        webm: 'video/webm',
        mov: 'video/quicktime',
        avi: 'video/x-msvideo',
        mkv: 'video/x-matroska',
        // Documents
        pdf: 'application/pdf',
      };

      const contentType = contentTypeMap[ext] || 'application/octet-stream';

      // Fetch from Shelby Protocol
      const shelbyUrl = `https://api.shelbynet.shelby.xyz/shelby/v1/blobs/${address}/${encodeURIComponent(filename)}`;

      logger.info({ shelbyUrl, contentType }, "Proxying file for inline view");

      const response = await fetch(shelbyUrl);

      if (!response.ok) {
        logger.error({ status: response.status, shelbyUrl }, "Failed to fetch from Shelby");
        return res.status(response.status).json({
          error: `Failed to fetch file: ${response.statusText}`
        });
      }

      // Set headers for inline display
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

      // Cache for 1 hour (files are immutable on Shelby)
      res.setHeader('Cache-Control', 'public, max-age=3600');

      // Stream the response
      const arrayBuffer = await response.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    } catch (error) {
      logger.error({ error }, "Failed to proxy file for viewing");
      res.status(500).json({ error: "Failed to fetch file" });
    }
  });

  /**
   * GET /api/share/viewer/:address/:filename
   * HTML viewer page that displays the file with a download button
   */
  router.get("/share/viewer/:address/:filename", async (req, res) => {
    try {
      const { address, filename } = req.params;

      if (!address || !filename) {
        return res.status(400).send("Missing address or filename");
      }

      // Determine file type from extension
      const ext = filename.split('.').pop()?.toLowerCase() || '';
      const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'avif'];
      const videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv'];
      const pdfExts = ['pdf'];

      const isImage = imageExts.includes(ext);
      const isVideo = videoExts.includes(ext);
      const isPdf = pdfExts.includes(ext);

      // URLs for viewing and downloading
      const viewUrl = `/api/share/view/${address}/${encodeURIComponent(filename)}`;
      const downloadUrl = `https://api.shelbynet.shelby.xyz/shelby/v1/blobs/${address}/${encodeURIComponent(filename)}`;

      // Generate the appropriate embed element based on file type
      let embedHtml = '';
      let extraStyles = '';
      let extraScripts = '';

      if (isImage) {
        embedHtml = `
          <div class="media-container image-container">
            <img src="${viewUrl}" alt="${filename}" id="mainImage" />
          </div>`;
      } else if (isVideo) {
        embedHtml = `
          <div class="media-container video-container">
            <video src="${viewUrl}" controls playsinline webkit-playsinline id="mainVideo"></video>
          </div>`;
        extraScripts = `
          // Auto-play video when loaded (muted for mobile autoplay policy)
          const video = document.getElementById('mainVideo');
          video.muted = true;
          video.play().catch(() => {});
          // Show controls to unmute
          video.addEventListener('click', () => { video.muted = false; });
        `;
      } else if (isPdf) {
        // For mobile, we need a different approach since iframes with PDFs don't work well
        embedHtml = `
          <div class="media-container pdf-container">
            <iframe src="${viewUrl}" id="pdfFrame" class="pdf-desktop"></iframe>
            <div class="pdf-mobile">
              <div class="pdf-icon">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
              </div>
              <p class="pdf-filename">${filename}</p>
              <p class="pdf-hint">Tap the button below to view or download</p>
              <a href="${viewUrl}" target="_blank" class="btn btn-primary btn-large">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                Open PDF
              </a>
            </div>
          </div>`;
        extraStyles = `
          .pdf-desktop { display: block; }
          .pdf-mobile { display: none; }
          @media (max-width: 768px) {
            .pdf-desktop { display: none; }
            .pdf-mobile {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              text-align: center;
              padding: 2rem;
              gap: 1rem;
            }
            .pdf-icon { color: #FF1493; margin-bottom: 0.5rem; }
            .pdf-filename { font-size: 1.1rem; font-weight: 500; word-break: break-all; color: #1a1a1a; }
            .pdf-hint { color: #737373; font-size: 0.9rem; }
          }
        `;
      } else {
        embedHtml = `
          <div class="media-container unsupported">
            <div class="unsupported-content">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                <polyline points="13 2 13 9 20 9"/>
              </svg>
              <p>${filename}</p>
              <p class="hint">Preview not available</p>
            </div>
          </div>`;
      }

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
  <meta name="theme-color" content="#FCFAF8">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <title>${filename} - Shelby Share</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      height: 100%;
      overflow: hidden;
    }
    body {
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace;
      background: #FCFAF8;
      color: #1a1a1a;
      min-height: 100vh;
      min-height: -webkit-fill-available;
      display: flex;
      flex-direction: column;
    }

    /* Header - Terminal style */
    header {
      padding: 0;
      background: #FFDFEF;
      border-bottom: 1px solid #FFC2E1;
      display: flex;
      align-items: stretch;
      flex-shrink: 0;
      z-index: 10;
    }
    .file-info {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 0.125rem;
      min-width: 0;
      flex: 1;
      padding: 0.75rem 1rem;
    }
    .file-info h1 {
      font-size: 0.85rem;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #1a1a1a;
    }
    .brand {
      color: #FF1493;
      font-size: 0.7rem;
      font-weight: 600;
    }
    .actions {
      display: flex;
      flex-shrink: 0;
    }

    /* Tab-style buttons */
    .btn-tab {
      background: none;
      border: none;
      border-left: 1px solid #FFC2E1;
      color: #737373;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.85rem;
      padding: 0.75rem 1rem;
      text-decoration: none;
      transition: color 0.2s, background-color 0.2s;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .btn-tab:hover {
      color: #FF1493;
      background-color: #FFC2E1;
    }
    .btn-tab svg {
      width: 16px;
      height: 16px;
    }

    /* Legacy btn styles for PDF mobile */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      padding: 0.75rem 1rem;
      font-size: 0.85rem;
      font-weight: 500;
      text-decoration: none;
      cursor: pointer;
      border: none;
      transition: all 0.15s;
      font-family: inherit;
    }
    .btn-primary {
      background: #FF1493;
      color: white;
      border-radius: 4px;
    }
    .btn-primary:hover {
      opacity: 0.9;
    }
    .btn-secondary {
      background: #FFC2E1;
      color: #737373;
      border: 1px solid #FFC2E1;
    }
    .btn-secondary:hover {
      color: #FF1493;
    }
    .btn-large {
      padding: 0.875rem 1.5rem;
      font-size: 1rem;
      gap: 0.5rem;
    }
    .btn svg { flex-shrink: 0; }

    /* Main content area */
    main {
      flex: 1;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: auto;
      -webkit-overflow-scrolling: touch;
      padding: 1rem;
      background: #F7F1E9;
    }

    /* Media containers */
    .media-container {
      display: flex;
      justify-content: center;
      align-items: center;
      width: 100%;
      height: 100%;
    }

    /* Images */
    .image-container img {
      max-width: 100%;
      max-height: calc(100vh - 80px);
      max-height: calc(100dvh - 80px);
      width: auto;
      height: auto;
      object-fit: contain;
      border-radius: 4px;
      border: 1px solid #FFC2E1;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    }

    /* Videos */
    .video-container video {
      max-width: 100%;
      max-height: calc(100vh - 80px);
      max-height: calc(100dvh - 80px);
      width: auto;
      height: auto;
      border-radius: 4px;
      border: 1px solid #FFC2E1;
      background: #000;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    }

    /* PDFs */
    .pdf-container iframe {
      width: 100%;
      height: calc(100vh - 80px);
      height: calc(100dvh - 80px);
      border: 1px solid #FFC2E1;
      border-radius: 4px;
      background: #fff;
    }

    /* Unsupported files */
    .unsupported-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
      color: #FF1493;
      text-align: center;
    }
    .unsupported-content p { font-size: 1rem; color: #1a1a1a; }
    .unsupported-content .hint { font-size: 0.875rem; color: #737373; }

    /* Mobile adjustments */
    @media (max-width: 480px) {
      .file-info h1 {
        font-size: 0.8rem;
      }
      .btn-tab {
        padding: 0.6rem 0.75rem;
        font-size: 0.8rem;
      }
      .btn-tab span {
        display: none;
      }
      main {
        padding: 0.5rem;
      }
      .image-container img,
      .video-container video {
        max-height: calc(100vh - 70px);
        max-height: calc(100dvh - 70px);
      }
    }

    /* Landscape mobile */
    @media (max-height: 500px) and (orientation: landscape) {
      .file-info h1 {
        font-size: 0.75rem;
      }
      .brand {
        display: none;
      }
      main {
        padding: 0.5rem;
      }
      .image-container img,
      .video-container video {
        max-height: calc(100vh - 70px);
        max-height: calc(100dvh - 70px);
      }
    }

    ${extraStyles}
  </style>
</head>
<body>
  <header>
    <div class="file-info">
      <h1>${filename}</h1>
      <span class="brand">Shelby Share</span>
    </div>
    <div class="actions">
      <button class="btn-tab" onclick="copyLink()" aria-label="Copy link">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        <span id="copyText">Copy</span>
      </button>
      <a href="${downloadUrl}" download="${filename}" class="btn-tab" aria-label="Download file">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <span>Download</span>
      </a>
    </div>
  </header>
  <main>
    ${embedHtml}
  </main>
  <script>
    function copyLink() {
      navigator.clipboard.writeText(window.location.href).then(() => {
        const btn = document.getElementById('copyText');
        if (btn) {
          btn.textContent = 'Copied!';
          setTimeout(() => btn.textContent = 'Copy', 2000);
        }
      }).catch(() => {
        // Fallback for older browsers
        const input = document.createElement('input');
        input.value = window.location.href;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        const btn = document.getElementById('copyText');
        if (btn) {
          btn.textContent = 'Copied!';
          setTimeout(() => btn.textContent = 'Copy', 2000);
        }
      });
    }
    ${extraScripts}
  </script>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      logger.error({ error }, "Failed to render viewer page");
      res.status(500).send("Failed to load viewer");
    }
  });

  return router;
}
