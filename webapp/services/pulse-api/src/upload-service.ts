import { Account, Ed25519PrivateKey, Network } from "@aptos-labs/ts-sdk";
import { ShelbyNodeClient } from "@shelby-protocol/sdk/node";
import { logger } from "./logger";

const SHELBY_RPC_BASE = "https://api.shelbynet.shelby.xyz/shelby";

// Characters that cause issues with Shelby blob names
function sanitizeFilename(name: string): string {
  // Replace problematic characters with underscores
  // Keep alphanumeric, dots, and underscores
  return name.replace(/[^a-zA-Z0-9._]/g, "_");
}

export interface UploadResult {
  url: string;
  viewerUrl: string;
  blobName: string;
  owner: string;
  size: number;
  expiresAt: string;
  /** Lease expiry in unix seconds — what capture_registry::register stores. */
  expiresAtUnix: number;
  /**
   * 0x-prefixed 32-byte blob commitment (Merkle root), read back from the
   * chain after the upload. Undefined when the read-back failed.
   */
  commitment?: string;
}

export class UploadService {
  private account: Account | null = null;
  private client: ShelbyNodeClient | null = null;
  private isInitialized = false;
  private lastFundTime = 0;
  private readonly FUND_COOLDOWN_MS = 60 * 1000; // 1 minute between fund attempts

  constructor(privateKey?: string, apiKey?: string) {
    if (privateKey) {
      this.initialize(privateKey, apiKey);
    }
  }

  private initialize(privateKey: string, apiKey?: string): void {
    try {
      const pk = new Ed25519PrivateKey(privateKey);
      this.account = Account.fromPrivateKey({ privateKey: pk });
      this.client = new ShelbyNodeClient({
        network: Network.SHELBYNET,
        apiKey: apiKey || undefined,
      });
      this.isInitialized = true;
      logger.info(
        { address: this.account.accountAddress.toString(), hasApiKey: !!apiKey },
        "Upload service initialized"
      );
    } catch (error) {
      logger.error({ error }, "Failed to initialize upload service");
      this.isInitialized = false;
    }
  }

  isAvailable(): boolean {
    return this.isInitialized && this.account !== null && this.client !== null;
  }

  getAddress(): string | null {
    return this.account?.accountAddress.toString() || null;
  }

  /**
   * Fund the upload account if needed (rate limited)
   */
  async ensureFunded(): Promise<void> {
    if (!this.client || !this.account) return;

    const now = Date.now();
    if (now - this.lastFundTime < this.FUND_COOLDOWN_MS) {
      return; // Skip if we recently funded
    }

    try {
      const address = this.account.accountAddress.toString();

      // Try to fund with ShelbyUSD
      await this.client.fundAccountWithShelbyUSD({
        address,
        amount: 1_000_000_000, // 10 ShelbyUSD
      });
      logger.info("Funded upload account with ShelbyUSD");

      // Also fund with APT for gas
      await this.client.fundAccountWithAPT({
        address,
        amount: 100_000_000, // 1 APT
      });
      logger.info("Funded upload account with APT");

      this.lastFundTime = now;
    } catch (error) {
      // Funding failures are not critical - account may already have funds
      logger.debug({ error }, "Fund attempt failed (may be rate limited)");
    }
  }

  /**
   * Read the just-uploaded blob's on-chain metadata: blobMerkleRoot is the
   * 32-byte commitment that capture_registry::register anchors and that a
   * Lilyshark pointer carries over the air. Read back from the chain rather
   * than recomputed locally, so the anchor vouches for what Shelby actually
   * registered.
   */
  private async readCommitment(blobName: string): Promise<string | undefined> {
    if (!this.client || !this.account) return undefined;
    try {
      const meta = await this.client.coordination.getBlobMetadata({
        account: this.account.accountAddress,
        name: blobName,
      });
      if (!meta) return undefined;
      return (
        "0x" +
        Array.from(meta.blobMerkleRoot)
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("")
      );
    } catch (error) {
      logger.warn({ error, blobName }, "Blob commitment read-back failed");
      return undefined;
    }
  }

  private async buildResult(
    blobName: string,
    size: number,
    expirationMicros: number,
  ): Promise<UploadResult> {
    const address = this.account!.accountAddress.toString();
    const url = `${SHELBY_RPC_BASE}/v1/blobs/${address}/${encodeURIComponent(blobName)}`;
    const viewerUrl = `/api/share/viewer/${address}/${encodeURIComponent(blobName)}`;
    return {
      url,
      viewerUrl,
      blobName,
      owner: address,
      size,
      expiresAt: new Date(expirationMicros / 1000).toISOString(),
      expiresAtUnix: Math.floor(expirationMicros / 1_000_000),
      commitment: await this.readCommitment(blobName),
    };
  }

  /**
   * Upload a file to Shelby
   */
  async uploadFile(
    fileBuffer: Buffer,
    originalName: string
  ): Promise<UploadResult> {
    if (!this.client || !this.account) {
      throw new Error("Upload service not initialized");
    }

    // Sanitize filename
    const blobName = sanitizeFilename(originalName);

    // Try to ensure we have funds
    await this.ensureFunded();

    // Expiration: 1 year from now (in microseconds)
    const expirationMicros =
      Date.now() * 1000 + 365 * 24 * 60 * 60 * 1000 * 1000;

    logger.info(
      { blobName, size: fileBuffer.length },
      "Uploading file to Shelby"
    );

    try {
      await this.client.upload({
        blobData: new Uint8Array(fileBuffer),
        signer: this.account,
        blobName,
        expirationMicros,
      });

      const result = await this.buildResult(
        blobName,
        fileBuffer.length,
        expirationMicros,
      );

      logger.info(
        { url: result.url, viewerUrl: result.viewerUrl, blobName },
        "File uploaded successfully",
      );

      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      logger.error({ errMsg, errStack, blobName }, "Failed to upload file");

      // If it's an insufficient funds error, try to fund and retry once
      if (
        error instanceof Error &&
        error.message.includes("INSUFFICIENT_FUNDS")
      ) {
        logger.info("Retrying upload after funding...");
        this.lastFundTime = 0; // Reset cooldown to force fund
        await this.ensureFunded();

        // Retry upload
        await this.client.upload({
          blobData: new Uint8Array(fileBuffer),
          signer: this.account,
          blobName,
          expirationMicros,
        });

        return this.buildResult(blobName, fileBuffer.length, expirationMicros);
      }

      throw error;
    }
  }
}
