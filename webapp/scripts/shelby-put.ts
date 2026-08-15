#!/usr/bin/env npx tsx
/**
 * Upload a file to Shelby via the official SDK — the whole flow the protocol
 * actually defines: commitment generation, on-chain registration, chunkset
 * upload to the RPC, and the commit ack.
 *
 * Usage:
 *   SHELBY_PRIVATE_KEY=ed25519-priv-0x… npx tsx scripts/shelby-put.ts <file> <blob-name> [days]
 *
 * Prints JSON with the owner address, blob name, size, expiry, and the
 * on-chain commitment (Merkle root) the Lilyshark pointer carries.
 */

import fs from "node:fs/promises";
import { Account, Ed25519PrivateKey, Network } from "@aptos-labs/ts-sdk";
import { ShelbyNodeClient } from "@shelby-protocol/sdk/node";

async function main() {
  const [, , file, blobName, daysArg] = process.argv;
  if (!file || !blobName) {
    console.error("usage: shelby-put.ts <file> <blob-name> [days]");
    process.exit(1);
  }
  const raw = process.env.SHELBY_PRIVATE_KEY;
  if (!raw) {
    console.error("SHELBY_PRIVATE_KEY is not set");
    process.exit(1);
  }
  const signer = Account.fromPrivateKey({
    privateKey: new Ed25519PrivateKey(raw.replace(/^ed25519-priv-/, "")),
  });

  const client = new ShelbyNodeClient({ network: Network.SHELBYNET });
  const blobData = new Uint8Array(await fs.readFile(file));
  const days = Number(daysArg ?? "90");
  const expirationMicros = (Date.now() + days * 86_400_000) * 1000;

  await client.upload({
    blobData,
    signer,
    blobName,
    expirationMicros,
    // shelbynet has one region; without a location the register txn aborts
    // with E_NO_LOCATION_SELECTED for accounts that never set a preference.
    options: { selectedLocation: "shelbynet-1" },
  });

  // Read back the on-chain metadata: blobMerkleRoot is the 32-byte
  // commitment the Lilyshark pointer carries over the air.
  let commitment: string | undefined;
  let onChainExpiry: number | undefined;
  try {
    const blobs = await client.coordination.getBlobs({
      where: { owner: { _eq: signer.accountAddress.toString() } },
      pagination: { limit: 50 },
    });
    const mine = blobs.find((b) => b.blobNameSuffix === blobName);
    if (mine) {
      commitment =
        "0x" +
        [...mine.blobMerkleRoot].map((v) => v.toString(16).padStart(2, "0")).join("");
      onChainExpiry = mine.expirationMicros;
    }
  } catch (e) {
    console.error("metadata readback failed:", e);
  }

  console.log(
    JSON.stringify(
      {
        owner: signer.accountAddress.toString(),
        blobName,
        size: blobData.length,
        expirationMicros,
        expiresAt: new Date(expirationMicros / 1000).toISOString(),
        commitment,
        onChainExpiry,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
