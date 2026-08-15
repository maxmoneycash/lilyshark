import { logger } from './logger';
import { ShelbyAptosClient } from './aptos-client';
import {
  getLastBlobSyncedVersion,
  insertBlobEvents,
  getBlobSyncStats,
  type BlobEventRecord,
} from './db';

// Blob event type for Shelby Protocol

// Track sync state
let blobSyncInProgress = false;
let initialBlobSyncComplete = false;

/**
 * Check if initial blob sync has completed
 */
export function isInitialBlobSyncComplete(): boolean {
  return initialBlobSyncComplete;
}

/**
 * Perform incremental blob sync - fetch new blob events since last sync
 * This runs in small batches to avoid rate limits
 */
export async function incrementalBlobSync(aptosClient: ShelbyAptosClient): Promise<number> {
  if (blobSyncInProgress) {
    logger.debug('Blob sync already in progress, skipping');
    return 0;
  }

  blobSyncInProgress = true;
  const startTime = Date.now();

  try {
    const lastVersion = getLastBlobSyncedVersion();
    logger.info({ lastVersion }, 'Starting incremental blob sync');

    // Fetch new blob events since last version
    const newEvents = await fetchBlobEventsSinceVersion(aptosClient, lastVersion);

    if (newEvents.length === 0) {
      logger.debug('No new blob events to sync');
      initialBlobSyncComplete = true;
      return 0;
    }

    // Insert events into database
    const inserted = insertBlobEvents(newEvents);

    const duration = Date.now() - startTime;
    const stats = getBlobSyncStats();

    logger.info(
      {
        inserted,
        fetched: newEvents.length,
        duration,
        totalBlobs: stats.totalBlobs,
        totalStorage: stats.totalStorage,
      },
      'Incremental blob sync complete'
    );

    initialBlobSyncComplete = true;
    return inserted;
  } catch (error) {
    logger.error({
      error,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    }, 'Incremental blob sync failed');
    // Don't throw - we want the sync interval to continue
    return 0;
  } finally {
    blobSyncInProgress = false;
  }
}

/**
 * Fetch blob events since a specific version
 * Uses pagination to avoid rate limits
 */
async function fetchBlobEventsSinceVersion(
  aptosClient: ShelbyAptosClient,
  sinceVersion: number
): Promise<BlobEventRecord[]> {
  const events: BlobEventRecord[] = [];
  const pageSize = 100; // Aptos indexer limit
  let offset = 0;
  let hasMore = true;

  // Limit per sync cycle to avoid rate limits (fetch ~1000 events per cycle)
  // With 30s interval, this catches up ~2000/min = 120k/hour
  const maxEventsPerCycle = 1000;

  // Get GraphQL config from client (includes API key in headers)
  const graphqlConfig = aptosClient.getGraphQLConfig();

  while (hasMore && events.length < maxEventsPerCycle) {
    // The indexer's generic `events` root field was removed; Shelby now exposes
    // first-class `blobs` / `blob_activities` tables with the fields already parsed.
    const query = `
      query GetNewBlobs($limit: Int!, $offset: Int!, $sinceVersion: bigint!) {
        blobs(
          where: { last_transaction_version: {_gt: $sinceVersion} }
          order_by: {last_transaction_version: asc}
          limit: $limit
          offset: $offset
        ) {
          uid
          last_transaction_version
          blob_commitment
          owner
          object_name
          size
          encoding
          created_at
          expires_at
          payment_amount
          is_deleted
        }
      }
    `;

    try {
      logger.debug({ url: graphqlConfig.url, offset, sinceVersion }, 'Fetching blob events page');

      const response = await fetch(graphqlConfig.url, {
        method: 'POST',
        headers: graphqlConfig.headers,
        body: JSON.stringify({
          query,
          variables: {
            limit: pageSize,
            offset,
            sinceVersion: sinceVersion.toString(),
          },
        }),
      });

      if (!response.ok) {
        logger.error({ status: response.status, statusText: response.statusText }, 'GraphQL request failed');
        break;
      }

      const result = await response.json();

      if (result.errors) {
        // Check for rate limit
        const rateLimitError = result.errors.find(
          (e: { extensions?: { code?: string } }) => e.extensions?.code === "429"
        );
        if (rateLimitError) {
          logger.warn('Rate limited during blob sync, returning partial results');
          break;
        }
        logger.warn({ errors: result.errors }, 'GraphQL errors during blob sync');
        break;
      }

      const fetched = result.data?.blobs || [];

      if (fetched.length === 0) {
        hasMore = false;
        break;
      }

      // Log first row for debugging
      if (offset === 0 && fetched.length > 0) {
        logger.info({ firstBlob: fetched[0] }, 'Sample blob row from indexer');
      }

      for (const row of fetched) {
        // `encoding` is already a plain string (e.g. "ClayCode_16Total_10Data_13Helper").
        // Timestamps arrive in MICROseconds; the local schema stores milliseconds.
        // Note: better-sqlite3 requires null, not undefined, for nullable fields.
        const toMillis = (v: unknown): number | null =>
          v === null || v === undefined ? null : Math.floor(Number(v) / 1000);

        const blobEvent: BlobEventRecord = {
          transaction_version: parseInt(row.last_transaction_version ?? '0', 10),
          // `uid` is unique per blob — using it as the second half of the primary key
          // stops multiple blobs in one transaction from overwriting each other.
          event_index: Number(row.uid ?? 0),
          blob_id: row.blob_commitment || '',
          owner_address: row.owner || '',
          size_bytes: Number(row.size ?? 0),
          encoding: row.encoding ?? null,
          blob_name: row.object_name ?? extractBlobName(row.blob_commitment) ?? null,
          creation_timestamp: toMillis(row.created_at),
          expiration_timestamp: toMillis(row.expires_at),
        };

        // Log first parsed row for debugging
        if (events.length === 0) {
          logger.info({ parsedEvent: blobEvent }, 'First parsed blob row');
        }

        events.push(blobEvent);
      }

      offset += pageSize;

      if (fetched.length < pageSize) {
        hasMore = false;
      }
    } catch (error) {
      logger.error({ error, offset }, 'Failed to fetch blob events page');
      break;
    }
  }

  return events;
}

/**
 * Extract blob name from blob_id (format: "prefix/name.ext")
 */
function extractBlobName(blobId: string | null | undefined): string | null {
  if (!blobId) return null;
  const parts = blobId.split('/');
  return parts[parts.length - 1] || null;
}

/**
 * Get blob sync status for monitoring
 */
export function getBlobSyncStatus(): {
  syncInProgress: boolean;
  initialSyncComplete: boolean;
  stats: ReturnType<typeof getBlobSyncStats>;
} {
  return {
    syncInProgress: blobSyncInProgress,
    initialSyncComplete: initialBlobSyncComplete,
    stats: getBlobSyncStats(),
  };
}
