#!/usr/bin/env npx tsx
/**
 * Shelby Upload Utilities
 *
 * Modular utilities for uploading files to Shelby and getting raw URLs.
 * Can be used as a CLI tool or imported as a module.
 *
 * CLI Usage:
 *   npx tsx scripts/shelby-upload.ts <file-path> [options]
 *   npx tsx scripts/shelby-upload.ts ./image.png --name "my-image.png"
 *   npx tsx scripts/shelby-upload.ts ./photo.jpg --expires 30d
 *
 * Module Usage:
 *   import { ShelbyUploader, uploadFile, getPublicUrl } from './shelby-upload'
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
} from "@aptos-labs/ts-sdk";

// ============================================================================
// Configuration
// ============================================================================

export interface ShelbyConfig {
  /** Shelby network */
  network: Network;
  /** Aptos API key (optional, prevents rate limiting) */
  apiKey?: string;
  /** Shelby RPC base URL */
  shelbyRpcUrl: string;
  /** Faucet URL for ShelbyUSD */
  faucetUrl: string;
  /** Fullnode URL */
  fullnodeUrl: string;
}

export const SHELBYNET_CONFIG: ShelbyConfig = {
  network: Network.CUSTOM,
  shelbyRpcUrl: "https://api.shelbynet.shelby.xyz/shelby",
  faucetUrl: "https://faucet.shelbynet.shelby.xyz",
  fullnodeUrl: "https://api.shelbynet.shelby.xyz/v1",
};

// Default expiration: 30 days
const DEFAULT_EXPIRATION_DAYS = 30;

// ShelbyUSD amount per faucet request (10 ShelbyUSD with 8 decimals)
const SHELBYUSD_PER_REQUEST = 1_000_000_000n;

// ============================================================================
// Types
// ============================================================================

export interface UploadOptions {
  /** Custom blob name (defaults to filename) */
  blobName?: string;
  /** Expiration in days from now */
  expirationDays?: number;
  /** Expiration as absolute timestamp (microseconds) */
  expirationMicros?: bigint;
  /** Content type hint */
  contentType?: string;
}

export interface UploadResult {
  /** Account address that owns the blob */
  owner: string;
  /** Blob name/path */
  blobName: string;
  /** Raw public URL to access the blob */
  publicUrl: string;
  /** Expiration timestamp (ISO string) */
  expiresAt: string;
  /** Transaction hash */
  txHash?: string;
}

export interface AccountInfo {
  address: string;
  aptBalance: bigint;
  shelbyUsdBalance: bigint;
}

// ============================================================================
// ShelbyUploader Class
// ============================================================================

export class ShelbyUploader {
  private config: ShelbyConfig;
  private aptos: Aptos;
  private account: Account;

  constructor(
    privateKeyOrAccount: string | Account,
    config: ShelbyConfig = SHELBYNET_CONFIG
  ) {
    this.config = config;

    // Initialize Aptos client
    const aptosConfig = new AptosConfig({
      network: config.network,
      fullnode: config.fullnodeUrl,
    });
    this.aptos = new Aptos(aptosConfig);

    // Initialize account
    if (typeof privateKeyOrAccount === "string") {
      const privateKey = new Ed25519PrivateKey(privateKeyOrAccount);
      this.account = Account.fromPrivateKey({ privateKey });
    } else {
      this.account = privateKeyOrAccount;
    }
  }

  get address(): string {
    return this.account.accountAddress.toString();
  }

  /**
   * Get account balances
   */
  async getAccountInfo(): Promise<AccountInfo> {
    const address = this.address;

    let aptBalance = 0n;
    let shelbyUsdBalance = 0n;

    try {
      const resources = await this.aptos.getAccountResources({
        accountAddress: address,
      });

      for (const resource of resources) {
        if (resource.type === "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>") {
          aptBalance = BigInt((resource.data as { coin: { value: string } }).coin.value);
        }
        // ShelbyUSD coin type - may vary, check for common patterns
        if (resource.type.includes("ShelbyUSD") || resource.type.includes("shelby_usd")) {
          shelbyUsdBalance = BigInt((resource.data as { coin: { value: string } }).coin.value);
        }
      }
    } catch (error) {
      // Account may not exist yet
    }

    return { address, aptBalance, shelbyUsdBalance };
  }

  /**
   * Request ShelbyUSD from faucet
   */
  async requestFaucet(amount: bigint = SHELBYUSD_PER_REQUEST): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.faucetUrl}/fund?asset=shelbyusd`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "*/*",
        },
        body: JSON.stringify({
          address: this.address,
          amount: amount.toString(),
        }),
      });

      const result = await response.json();
      return result.txn_hashes && result.txn_hashes.length > 0;
    } catch (error) {
      console.error("Faucet request failed:", error);
      return false;
    }
  }

  /**
   * Request APT from faucet (for gas)
   */
  async requestAptFaucet(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.faucetUrl}/fund?asset=apt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "*/*",
        },
        body: JSON.stringify({
          address: this.address,
          amount: "100000000", // 1 APT
        }),
      });

      const result = await response.json();
      return result.txn_hashes && result.txn_hashes.length > 0;
    } catch (error) {
      console.error("APT faucet request failed:", error);
      return false;
    }
  }

  /**
   * Upload a file to Shelby
   */
  async uploadFile(filePath: string, options: UploadOptions = {}): Promise<UploadResult> {
    const fileBuffer = await fs.readFile(filePath);
    const fileName = options.blobName || path.basename(filePath);

    return this.uploadBuffer(fileBuffer, fileName, options);
  }

  /**
   * Upload a buffer to Shelby
   */
  async uploadBuffer(
    data: Buffer | Uint8Array,
    blobName: string,
    options: UploadOptions = {}
  ): Promise<UploadResult> {
    // Calculate expiration
    const expirationMicros =
      options.expirationMicros ||
      BigInt(Date.now() + (options.expirationDays || DEFAULT_EXPIRATION_DAYS) * 24 * 60 * 60 * 1000) * 1000n;

    // Prepare multipart form data
    const formData = new FormData();
    const blob = new Blob([data]);
    formData.append("file", blob, blobName);
    formData.append("account_address", this.address);
    formData.append("blob_name", blobName);
    formData.append("expiration_micros", expirationMicros.toString());

    // Sign the upload request
    const message = `upload:${this.address}:${blobName}:${expirationMicros}`;
    const signature = this.account.sign(new TextEncoder().encode(message));
    formData.append("signature", signature.toString());
    formData.append("public_key", this.account.publicKey.toString());

    // Upload to Shelby RPC
    const response = await fetch(`${this.config.shelbyRpcUrl}/v1/upload`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    return {
      owner: this.address,
      blobName,
      publicUrl: getPublicUrl(this.address, blobName, this.config),
      expiresAt: new Date(Number(expirationMicros / 1000n)).toISOString(),
      txHash: result.tx_hash,
    };
  }

  /**
   * Upload from a URL (fetch and upload)
   */
  async uploadFromUrl(url: string, blobName: string, options: UploadOptions = {}): Promise<UploadResult> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return this.uploadBuffer(buffer, blobName, options);
  }

  /**
   * Check if a blob exists
   */
  async blobExists(blobName: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.config.shelbyRpcUrl}/v1/blob/${this.address}/${encodeURIComponent(blobName)}`,
        { method: "HEAD" }
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * List blobs for this account
   */
  async listBlobs(): Promise<Array<{ name: string; size: number; expires: string }>> {
    const response = await fetch(
      `${this.config.shelbyRpcUrl}/v1/blobs/${this.address}`
    );

    if (!response.ok) {
      return [];
    }

    return response.json();
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get public URL for a blob
 */
export function getPublicUrl(
  owner: string,
  blobName: string,
  config: ShelbyConfig = SHELBYNET_CONFIG
): string {
  return `${config.shelbyRpcUrl}/v1/blobs/${owner}/${encodeURIComponent(blobName)}`;
}

/**
 * Create a new random account
 */
export function createAccount(): { account: Account; privateKey: string } {
  const account = Account.generate();
  return {
    account,
    privateKey: account.privateKey.toString(),
  };
}

/**
 * Load account from private key file or env
 */
export async function loadAccount(
  privateKeyOrPath?: string
): Promise<Account> {
  // Check environment variable first
  const envKey = process.env.SHELBY_PRIVATE_KEY || process.env.APTOS_PRIVATE_KEY;

  if (envKey) {
    const privateKey = new Ed25519PrivateKey(envKey);
    return Account.fromPrivateKey({ privateKey });
  }

  // Check for file path
  if (privateKeyOrPath) {
    try {
      const stats = await fs.stat(privateKeyOrPath);
      if (stats.isFile()) {
        const content = await fs.readFile(privateKeyOrPath, "utf-8");
        const key = content.trim();
        const privateKey = new Ed25519PrivateKey(key);
        return Account.fromPrivateKey({ privateKey });
      }
    } catch {
      // Not a file, treat as private key string
    }

    const privateKey = new Ed25519PrivateKey(privateKeyOrPath);
    return Account.fromPrivateKey({ privateKey });
  }

  // Check for local key file
  const localKeyPath = path.join(process.cwd(), ".shelby-key");
  try {
    const content = await fs.readFile(localKeyPath, "utf-8");
    const privateKey = new Ed25519PrivateKey(content.trim());
    return Account.fromPrivateKey({ privateKey });
  } catch {
    // No local key file
  }

  throw new Error(
    "No private key found. Set SHELBY_PRIVATE_KEY env var, pass --key, or create .shelby-key file"
  );
}

/**
 * Quick upload helper - creates uploader, uploads file, returns URL
 */
export async function uploadFile(
  filePath: string,
  options: UploadOptions & { privateKey?: string } = {}
): Promise<UploadResult> {
  const account = await loadAccount(options.privateKey);
  const uploader = new ShelbyUploader(account);
  return uploader.uploadFile(filePath, options);
}

/**
 * Batch upload multiple files
 */
export async function uploadFiles(
  filePaths: string[],
  options: UploadOptions & { privateKey?: string } = {}
): Promise<UploadResult[]> {
  const account = await loadAccount(options.privateKey);
  const uploader = new ShelbyUploader(account);

  const results: UploadResult[] = [];
  for (const filePath of filePaths) {
    const result = await uploader.uploadFile(filePath, options);
    results.push(result);
  }

  return results;
}

// ============================================================================
// CLI
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
Shelby Upload Utility

Usage:
  npx tsx scripts/shelby-upload.ts <file-path> [options]
  npx tsx scripts/shelby-upload.ts <file1> <file2> ... [options]

Options:
  --name <name>      Custom blob name (for single file)
  --expires <days>   Expiration in days (default: 30)
  --key <key>        Private key (or set SHELBY_PRIVATE_KEY env)
  --new-account      Generate a new account
  --fund             Request tokens from faucet before upload
  --info             Show account info only
  --json             Output as JSON
  --help, -h         Show this help

Examples:
  # Upload a single file
  npx tsx scripts/shelby-upload.ts ./image.png

  # Upload with custom name
  npx tsx scripts/shelby-upload.ts ./photo.jpg --name "profile.jpg"

  # Upload multiple files
  npx tsx scripts/shelby-upload.ts ./img1.png ./img2.png ./img3.png

  # Generate new account and fund it
  npx tsx scripts/shelby-upload.ts --new-account --fund

  # Upload with new account
  npx tsx scripts/shelby-upload.ts ./file.png --new-account --fund

Environment:
  SHELBY_PRIVATE_KEY  Private key for uploads
  APTOS_PRIVATE_KEY   Alternative env var for private key
    `);
    process.exit(0);
  }

  // Parse arguments
  const files: string[] = [];
  let blobName: string | undefined;
  let expirationDays = DEFAULT_EXPIRATION_DAYS;
  let privateKey: string | undefined;
  let newAccount = false;
  let fund = false;
  let infoOnly = false;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--name" && args[i + 1]) {
      blobName = args[++i];
    } else if (arg === "--expires" && args[i + 1]) {
      expirationDays = parseInt(args[++i], 10);
    } else if (arg === "--key" && args[i + 1]) {
      privateKey = args[++i];
    } else if (arg === "--new-account") {
      newAccount = true;
    } else if (arg === "--fund") {
      fund = true;
    } else if (arg === "--info") {
      infoOnly = true;
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (!arg.startsWith("--")) {
      files.push(arg);
    }
  }

  // Create or load account
  let account: Account;

  if (newAccount) {
    const { account: newAcc, privateKey: pk } = createAccount();
    account = newAcc;

    if (!jsonOutput) {
      console.log("Generated new account:");
      console.log(`  Address: ${account.accountAddress.toString()}`);
      console.log(`  Private Key: ${pk}`);
      console.log("");
      console.log("Save this private key! Set as SHELBY_PRIVATE_KEY or use --key");
      console.log("");
    }
  } else {
    try {
      account = await loadAccount(privateKey);
    } catch (error) {
      console.error((error as Error).message);
      process.exit(1);
    }
  }

  const uploader = new ShelbyUploader(account);

  // Fund if requested
  if (fund) {
    if (!jsonOutput) {
      console.log("Requesting tokens from faucet...");
    }

    const aptSuccess = await uploader.requestAptFaucet();
    const shelbySuccess = await uploader.requestFaucet();

    if (!jsonOutput) {
      console.log(`  APT: ${aptSuccess ? "Success" : "Failed"}`);
      console.log(`  ShelbyUSD: ${shelbySuccess ? "Success" : "Failed"}`);
      console.log("");
    }
  }

  // Show account info
  if (infoOnly || files.length === 0) {
    const info = await uploader.getAccountInfo();

    if (jsonOutput) {
      console.log(JSON.stringify(info, (_, v) => typeof v === "bigint" ? v.toString() : v));
    } else {
      console.log("Account Info:");
      console.log(`  Address: ${info.address}`);
      console.log(`  APT Balance: ${Number(info.aptBalance) / 1e8} APT`);
      console.log(`  ShelbyUSD Balance: ${Number(info.shelbyUsdBalance) / 1e8} ShelbyUSD`);
    }

    if (infoOnly || files.length === 0) {
      process.exit(0);
    }
  }

  // Upload files
  const results: UploadResult[] = [];

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const name = files.length === 1 && blobName ? blobName : undefined;

    if (!jsonOutput) {
      console.log(`Uploading ${filePath}...`);
    }

    try {
      const result = await uploader.uploadFile(filePath, {
        blobName: name,
        expirationDays,
      });

      results.push(result);

      if (!jsonOutput) {
        console.log(`  Blob: ${result.blobName}`);
        console.log(`  URL: ${result.publicUrl}`);
        console.log(`  Expires: ${result.expiresAt}`);
        console.log("");
      }
    } catch (error) {
      console.error(`Failed to upload ${filePath}:`, (error as Error).message);
      process.exit(1);
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log("Done! Raw URLs for your files:");
    console.log("");
    for (const result of results) {
      console.log(result.publicUrl);
    }
  }
}

// Run CLI if executed directly
const isMainModule = process.argv[1]?.endsWith("shelby-upload.ts");
if (isMainModule) {
  main().catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
}
