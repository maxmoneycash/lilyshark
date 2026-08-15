#!/usr/bin/env npx tsx
/**
 * Simple Shelby Image Uploader
 *
 * Quick utility to upload images and get raw URLs for use in websites.
 * Replaces raw.githubusercontent.com URLs with Shelby URLs.
 *
 * Usage:
 *   npx tsx scripts/shelby-image.ts <image-path>
 *   npx tsx scripts/shelby-image.ts ./logo.png ./banner.jpg
 *
 * Output:
 *   Just prints the raw URLs, one per line - easy to copy/paste.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  Account,
  Ed25519PrivateKey,
  Network,
} from "@aptos-labs/ts-sdk";
import { ShelbyNodeClient } from "@shelby-protocol/sdk/node";

// ============================================================================
// Config
// ============================================================================

const SHELBY_RPC_BASE = "https://api.shelbynet.shelby.xyz/shelby";
const SUPPORTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".avif"];

// ============================================================================
// Core Functions
// ============================================================================

async function getAccount(): Promise<Account> {
  // Try env vars
  const envKey = process.env.SHELBY_PRIVATE_KEY || process.env.APTOS_PRIVATE_KEY;
  if (envKey) {
    return Account.fromPrivateKey({
      privateKey: new Ed25519PrivateKey(envKey),
    });
  }

  // Try local key file
  const keyPath = path.join(process.cwd(), ".shelby-key");
  try {
    const key = (await fs.readFile(keyPath, "utf-8")).trim();
    return Account.fromPrivateKey({
      privateKey: new Ed25519PrivateKey(key),
    });
  } catch {
    // Generate new account
    const account = Account.generate();
    await fs.writeFile(keyPath, account.privateKey.toString());
    console.error(`Created new account: ${account.accountAddress.toString()}`);
    console.error(`Private key saved to: ${keyPath}`);
    console.error("");
    return account;
  }
}

function getBlobUrl(owner: string, blobName: string): string {
  return `${SHELBY_RPC_BASE}/v1/blobs/${owner}/${encodeURIComponent(blobName)}`;
}

function sanitizeFilename(name: string): string {
  // Replace problematic characters with underscores
  // Keep alphanumeric, dots, and underscores
  return name.replace(/[^a-zA-Z0-9._]/g, "_");
}

async function uploadImage(
  client: ShelbyNodeClient,
  account: Account,
  filePath: string,
  customName?: string
): Promise<string> {
  const rawName = customName || path.basename(filePath);
  const fileName = sanitizeFilename(rawName);
  const fileBuffer = await fs.readFile(filePath);
  const address = account.accountAddress.toString();

  // Expiration: 1 year from now (in microseconds)
  const expirationMicros = Date.now() * 1000 + 365 * 24 * 60 * 60 * 1000 * 1000;

  await client.upload({
    blobData: new Uint8Array(fileBuffer),
    signer: account,
    blobName: fileName,
    expirationMicros,
  });

  return getBlobUrl(address, fileName);
}

// ============================================================================
// CLI
// ============================================================================

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const flags = process.argv.slice(2).filter((a) => a.startsWith("-"));

  if (args.length === 0 || flags.includes("--help") || flags.includes("-h")) {
    console.log(`
Shelby Image Uploader - Get raw URLs for your images

Usage:
  npx tsx scripts/shelby-image.ts <image> [image2] [image3] ...

Options:
  --fund    Fund account from faucet first
  --help    Show this help

Examples:
  npx tsx scripts/shelby-image.ts logo.png
  npx tsx scripts/shelby-image.ts ./images/*.png
  npx tsx scripts/shelby-image.ts hero.jpg --fund

Environment:
  SHELBY_PRIVATE_KEY   Your private key (or create .shelby-key file)

Output:
  Prints raw URLs only - one per line, ready to copy/paste.
`);
    process.exit(0);
  }

  // Validate files
  for (const file of args) {
    const ext = path.extname(file).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      console.error(`Unsupported file type: ${file}`);
      console.error(`Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`);
      process.exit(1);
    }

    try {
      await fs.access(file);
    } catch {
      console.error(`File not found: ${file}`);
      process.exit(1);
    }
  }

  // Get account
  const account = await getAccount();
  const address = account.accountAddress.toString();

  // Create Shelby client
  const client = new ShelbyNodeClient({
    network: Network.SHELBYNET,
  });

  // Fund if requested
  if (flags.includes("--fund")) {
    console.error("Funding account...");
    try {
      await client.fundAccountWithAPT({
        address,
        amount: 100_000_000, // 1 APT
      });
      console.error("  APT: Success");
    } catch (e) {
      console.error(`  APT: Failed - ${(e as Error).message}`);
    }

    try {
      await client.fundAccountWithShelbyUSD({
        address,
        amount: 1_000_000_000, // 10 ShelbyUSD
      });
      console.error("  ShelbyUSD: Success");
    } catch (e) {
      console.error(`  ShelbyUSD: Failed - ${(e as Error).message}`);
    }
    console.error("");
  }

  // Upload each file
  const urls: string[] = [];

  for (const file of args) {
    try {
      console.error(`Uploading: ${file}`);
      const url = await uploadImage(client, account, file);
      urls.push(url);
      console.error(`  Done`);
    } catch (error) {
      console.error(`  Failed: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  // Output URLs only (to stdout)
  console.log("");
  for (const url of urls) {
    console.log(url);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
