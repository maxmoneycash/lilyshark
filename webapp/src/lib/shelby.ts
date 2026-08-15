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
  name: 'captures/field-capture-0847.lscap',
  commitment: '0xacae433ef0821bee7e99a9c1687473fc9f3a432fc06a97fb908cbf8f35596d4b',
  sizeBytes: 4689,
  expiresAtUnix: 1_794_605_647,
} as const;

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

/** RPC read: the blob's bytes, straight from the storage network. */
export async function fetchBlob(owner: string, name: string): Promise<ArrayBuffer> {
  const res = await fetch(`${SHELBY_RPC_BLOBS}/${owner}/${name}`);
  if (!res.ok) throw new Error(`shelby RPC HTTP ${res.status}`);
  return res.arrayBuffer();
}
