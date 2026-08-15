#!/usr/bin/env npx tsx
/**
 * Migrate Images from GitHub to Shelby
 *
 * Scans markdown files for raw.githubusercontent.com URLs,
 * downloads and uploads them to Shelby, and updates the files.
 *
 * Usage:
 *   npx tsx scripts/shelby-migrate-images.ts README.md
 *   npx tsx scripts/shelby-migrate-images.ts docs/*.md
 *   npx tsx scripts/shelby-migrate-images.ts --dry-run README.md
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  Account,
  Ed25519PrivateKey,
} from "@aptos-labs/ts-sdk";

// ============================================================================
// Config
// ============================================================================

const SHELBY_RPC = "https://api.shelbynet.shelby.xyz/shelby";
const FAUCET_URL = "https://faucet.shelbynet.shelby.xyz";

// Patterns to find image URLs
const URL_PATTERNS = [
  // raw.githubusercontent.com
  /https:\/\/raw\.githubusercontent\.com\/[^\s\)\"\']+\.(png|jpg|jpeg|gif|webp|svg|ico|avif)/gi,
  // github.com/.../raw/
  /https:\/\/github\.com\/[^\s\)\"\']+\/raw\/[^\s\)\"\']+\.(png|jpg|jpeg|gif|webp|svg|ico|avif)/gi,
  // user-images.githubusercontent.com
  /https:\/\/user-images\.githubusercontent\.com\/[^\s\)\"\']+/gi,
];

// ============================================================================
// Core Functions
// ============================================================================

async function getAccount(): Promise<Account> {
  const envKey = process.env.SHELBY_PRIVATE_KEY || process.env.APTOS_PRIVATE_KEY;
  if (envKey) {
    return Account.fromPrivateKey({
      privateKey: new Ed25519PrivateKey(envKey),
    });
  }

  const keyPath = path.join(process.cwd(), ".shelby-key");
  try {
    const key = (await fs.readFile(keyPath, "utf-8")).trim();
    return Account.fromPrivateKey({
      privateKey: new Ed25519PrivateKey(key),
    });
  } catch {
    const account = Account.generate();
    await fs.writeFile(keyPath, account.privateKey.toString());
    console.log(`Created new account: ${account.accountAddress.toString()}`);
    console.log(`Private key saved to: ${keyPath}\n`);
    return account;
  }
}

async function fundAccount(address: string): Promise<void> {
  await Promise.all([
    fetch(`${FAUCET_URL}/fund?asset=apt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, amount: "100000000" }),
    }),
    fetch(`${FAUCET_URL}/fund?asset=shelbyusd`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, amount: "1000000000" }),
    }),
  ]);
}

function getBlobUrl(owner: string, blobName: string): string {
  return `${SHELBY_RPC}/v1/blobs/${owner}/${encodeURIComponent(blobName)}`;
}

async function downloadAndUpload(
  account: Account,
  url: string,
  cache: Map<string, string>
): Promise<string> {
  // Check cache
  if (cache.has(url)) {
    return cache.get(url)!;
  }

  // Download
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());

  // Generate blob name from URL
  const urlPath = new URL(url).pathname;
  const fileName = path.basename(urlPath) || `image-${Date.now()}.png`;
  const blobName = `migrated/${fileName}`;
  const address = account.accountAddress.toString();

  // Expiration: 1 year
  const expirationMicros = BigInt(Date.now() + 365 * 24 * 60 * 60 * 1000) * 1000n;

  // Create form data
  const formData = new FormData();
  formData.append("file", new Blob([buffer]), blobName);
  formData.append("account_address", address);
  formData.append("blob_name", blobName);
  formData.append("expiration_micros", expirationMicros.toString());

  // Sign
  const message = `upload:${address}:${blobName}:${expirationMicros}`;
  const signature = account.sign(new TextEncoder().encode(message));
  formData.append("signature", signature.toString());
  formData.append("public_key", account.publicKey.toString());

  // Upload
  const uploadResponse = await fetch(`${SHELBY_RPC}/v1/upload`, {
    method: "POST",
    body: formData,
  });

  if (!uploadResponse.ok) {
    const error = await uploadResponse.text();
    throw new Error(`Upload failed: ${error}`);
  }

  const newUrl = getBlobUrl(address, blobName);
  cache.set(url, newUrl);
  return newUrl;
}

function findUrls(content: string): string[] {
  const urls = new Set<string>();
  for (const pattern of URL_PATTERNS) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      urls.add(match[0]);
    }
  }
  return Array.from(urls);
}

// ============================================================================
// CLI
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith("-"));
  const dryRun = args.includes("--dry-run");
  const fund = args.includes("--fund");

  if (files.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
Migrate Images from GitHub to Shelby

Scans files for GitHub image URLs and replaces them with Shelby URLs.

Usage:
  npx tsx scripts/shelby-migrate-images.ts <file> [files...]

Options:
  --dry-run   Show what would change without modifying files
  --fund      Fund account from faucet first
  --help      Show this help

Examples:
  npx tsx scripts/shelby-migrate-images.ts README.md
  npx tsx scripts/shelby-migrate-images.ts docs/*.md --dry-run
  npx tsx scripts/shelby-migrate-images.ts README.md --fund

Detects URLs from:
  - raw.githubusercontent.com
  - github.com/.../raw/...
  - user-images.githubusercontent.com
`);
    process.exit(0);
  }

  const account = await getAccount();
  const address = account.accountAddress.toString();

  if (fund) {
    console.log("Funding account...");
    await fundAccount(address);
    console.log("Done\n");
  }

  const cache = new Map<string, string>();
  let totalFound = 0;
  let totalMigrated = 0;

  for (const filePath of files) {
    try {
      await fs.access(filePath);
    } catch {
      console.error(`File not found: ${filePath}`);
      continue;
    }

    console.log(`\nScanning: ${filePath}`);
    let content = await fs.readFile(filePath, "utf-8");
    const urls = findUrls(content);

    if (urls.length === 0) {
      console.log("  No GitHub image URLs found");
      continue;
    }

    console.log(`  Found ${urls.length} GitHub image URL(s)`);
    totalFound += urls.length;

    for (const url of urls) {
      console.log(`  - ${url}`);

      if (dryRun) {
        console.log(`    → Would migrate to Shelby`);
        continue;
      }

      try {
        const newUrl = await downloadAndUpload(account, url, cache);
        content = content.replaceAll(url, newUrl);
        console.log(`    → ${newUrl}`);
        totalMigrated++;
      } catch (error) {
        console.error(`    ✗ Failed: ${(error as Error).message}`);
      }
    }

    if (!dryRun && totalMigrated > 0) {
      await fs.writeFile(filePath, content);
      console.log(`  Updated: ${filePath}`);
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Total URLs found: ${totalFound}`);
  if (dryRun) {
    console.log("Dry run - no changes made");
  } else {
    console.log(`Total migrated: ${totalMigrated}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
