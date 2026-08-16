/**
 * Shelby resolution, in the browser, with no proxy in between.
 *
 * A Lilyshark pointer carries a blob commitment and an owner — not a name —
 * so resolving one is a two-step walk any gateway would do:
 *
 *   1. ask the shelbynet indexer which of the owner's blobs carries that
 *      commitment (GraphQL, CORS-approved for this origin), and
 *   2. fetch the bytes from the Shelby RPC by owner + object name
 *      (plain GET, `access-control-allow-origin: *`).
 *
 * Both endpoints are the protocol's own; nothing here goes through a
 * Lilyshark server.
 */

export const SHELBY_RPC_BLOBS = 'https://shelby.shelbynet.shelby.xyz/shelby/v1/blobs';
export const SHELBY_INDEXER = 'https://api.shelbynet.aptoslabs.com/v1/graphql';

/**
 * The live demo blob: a field capture uploaded to shelbynet with
 * scripts/shelby-put.ts. The bundled sample's frame 9 and every live demo
 * pointer reference it, so RESOLVE exercises the real network end to end.
 */
export const DEMO_BLOB = {
  owner: '0x34946d19fb18115046c807b8f48845a515efe107892bb9cc49c6f197a6998728',
  name: 'captures/field-capture-0846.lscap',
  commitment: '0x6ab9566563ba70a73965f89a46edf3d49978c5091b8da8786e8cb58a449a32c9',
  sizeBytes: 4495,
  expiresAtUnix: 1_794_606_691,
} as const;

export const SHELBY_FULLNODE = 'https://api.shelbynet.aptoslabs.com/v1';

/** The Move module that anchors captures on-chain (contracts/capture-registry). */
export const CAPTURE_REGISTRY = `${DEMO_BLOB.owner}::capture_registry`;

export interface CaptureAnchor {
  blobName: string;
  sizeBytes: number;
  expiresAtUnix: number;
  registeredAtUnix: number;
}

/**
 * On-chain anchor lookup: did `publisher` vouch for `commitment` in the
 * capture registry? Read straight from the fullnode's resource API — the
 * same bytes any wallet or explorer would see. Returns null when the
 * publisher has no registry or never anchored this commitment.
 */
export async function fetchAnchor(
  publisher: string,
  commitment: string,
): Promise<CaptureAnchor | null> {
  const res = await fetch(
    `${SHELBY_FULLNODE}/accounts/${publisher}/resource/${CAPTURE_REGISTRY}::Registry`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fullnode HTTP ${res.status}`);
  const body = (await res.json()) as {
    data?: {
      captures?: {
        blob_name: string;
        commitment: string;
        size_bytes: string;
        expires_at_unix: string;
        registered_at_unix: string;
      }[];
    };
  };
  const row = body.data?.captures?.find(
    (c) => c.commitment.toLowerCase() === commitment.toLowerCase(),
  );
  if (!row) return null;
  return {
    blobName: row.blob_name,
    sizeBytes: Number(row.size_bytes),
    expiresAtUnix: Number(row.expires_at_unix),
    registeredAtUnix: Number(row.registered_at_unix),
  };
}

export interface ResolvedBlob {
  /** Name suffix under the owner (e.g. "captures/field-capture-0847.lscap"). */
  name: string;
  sizeBytes: number;
  expiresAtMicros: number;
  committed: boolean;
}

/** Indexer lookup: which of `owner`'s blobs carries `commitment`? */
export async function resolveByCommitment(
  owner: string,
  commitment: string,
): Promise<ResolvedBlob | null> {
  const res = await fetch(SHELBY_INDEXER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query:
        'query($o:String,$c:String){blobs(where:{owner:{_eq:$o},blob_commitment:{_eq:$c}}){object_name blob_commitment size expires_at is_committed}}',
      variables: { o: owner.toLowerCase(), c: commitment.toLowerCase() },
    }),
  });
  if (!res.ok) throw new Error(`indexer HTTP ${res.status}`);
  const body = (await res.json()) as {
    data?: {
      blobs?: {
        object_name: string;
        size: number;
        expires_at: number;
        is_committed: number;
      }[];
    };
  };
  const row = body.data?.blobs?.[0];
  if (!row) return null;
  // object_name is "@<addr-no-0x>/<suffix>"; the RPC read wants the suffix.
  const name = row.object_name.replace(/^@[0-9a-f]+\//, '');
  return {
    name,
    sizeBytes: row.size,
    expiresAtMicros: row.expires_at,
    committed: row.is_committed === 1,
  };
}

/**
 * RPC read: the blob's bytes, straight from the storage network.
 *
 * The anonymous endpoint rate-limits per IP on a 5-minute window, so a burst
 * of resolves (a rehearsal, a classroom) can hit 429 on an otherwise healthy
 * network. Those get a couple of spaced retries before giving up;
 * `onRetry` lets the caller narrate the wait instead of appearing hung.
 */
export async function fetchBlob(
  owner: string,
  name: string,
  onRetry?: (attempt: number, waitMs: number) => void,
): Promise<ArrayBuffer> {
  const waits = [2500, 6000];
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${SHELBY_RPC_BLOBS}/${owner}/${name}`);
    if (res.ok) return res.arrayBuffer();
    if (res.status === 429 && attempt < waits.length) {
      onRetry?.(attempt + 1, waits[attempt]);
      await new Promise((r) => setTimeout(r, waits[attempt]));
      continue;
    }
    throw new Error(
      res.status === 429
        ? 'shelby RPC rate-limited (429) — wait a minute and try again'
        : `shelby RPC HTTP ${res.status}`,
    );
  }
}
