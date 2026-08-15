import { logger } from './logger';
import { ShelbyAptosClient, SHELBYUSD_METADATA } from './aptos-client';
import {
  getLastSyncedVersion,
  insertActivities,
  updateAddressStats,
  invalidateAllLeaderboards,
  resetDatabase,
  getDatabaseStats,
  type ActivityRecord,
} from './db';

// Track if initial sync has completed
let initialSyncComplete = false;
let syncInProgress = false;

/**
 * Check if initial sync has completed (DB has data)
 */
export function isInitialSyncComplete(): boolean {
  return initialSyncComplete;
}

/**
 * Perform incremental sync - fetch only new activities since last sync
 * Returns the number of new activities synced
 */
export async function incrementalSync(aptosClient: ShelbyAptosClient): Promise<number> {
  if (syncInProgress) {
    logger.info('Sync already in progress, skipping');
    return 0;
  }

  syncInProgress = true;
  const startTime = Date.now();

  try {
    const lastVersion = getLastSyncedVersion();
    logger.info({ lastVersion }, 'Starting incremental sync');

    // Fetch new activities since last version
    const newActivities = await fetchActivitiesSinceVersion(aptosClient, lastVersion);

    if (newActivities.length === 0) {
      logger.info('No new activities to sync');
      initialSyncComplete = true;
      return 0;
    }

    // Insert activities into database
    const inserted = insertActivities(newActivities);

    // Update address stats incrementally
    updateAddressStats(newActivities);

    // Invalidate leaderboard caches since data changed
    invalidateAllLeaderboards();

    const duration = Date.now() - startTime;
    logger.info(
      { inserted, fetched: newActivities.length, duration, lastVersion: newActivities[0]?.transaction_version },
      'Incremental sync complete'
    );

    initialSyncComplete = true;
    return inserted;
  } catch (error) {
    logger.error({ error }, 'Incremental sync failed');
    throw error;
  } finally {
    syncInProgress = false;
  }
}

/**
 * Perform a full sync - reset DB and fetch all activities from scratch
 * Use sparingly - only for recovery or data corrections
 */
export async function fullSync(aptosClient: ShelbyAptosClient): Promise<number> {
  if (syncInProgress) {
    logger.info('Sync already in progress, skipping full sync');
    return 0;
  }

  syncInProgress = true;
  const startTime = Date.now();

  try {
    logger.info('Starting full sync - resetting database');
    resetDatabase();

    // Fetch all activities (this is the expensive operation)
    const allActivities = await fetchAllActivities(aptosClient);

    if (allActivities.length === 0) {
      logger.info('No activities found during full sync');
      initialSyncComplete = true;
      return 0;
    }

    // Insert in batches to avoid memory issues
    const BATCH_SIZE = 10000;
    let totalInserted = 0;

    for (let i = 0; i < allActivities.length; i += BATCH_SIZE) {
      const batch = allActivities.slice(i, i + BATCH_SIZE);
      const inserted = insertActivities(batch);
      totalInserted += inserted;
      logger.info({ batch: Math.floor(i / BATCH_SIZE) + 1, inserted }, 'Inserted batch');
    }

    // Build address stats from all activities
    updateAddressStats(allActivities);

    const duration = Date.now() - startTime;
    logger.info(
      { totalInserted, duration },
      'Full sync complete'
    );

    initialSyncComplete = true;
    return totalInserted;
  } catch (error) {
    logger.error({ error }, 'Full sync failed');
    throw error;
  } finally {
    syncInProgress = false;
  }
}

/**
 * Fetch activities since a specific version (incremental)
 */
async function fetchActivitiesSinceVersion(
  aptosClient: ShelbyAptosClient,
  sinceVersion: number
): Promise<ActivityRecord[]> {
  const activities: ActivityRecord[] = [];
  const pageSize = 100;
  let offset = 0;
  let hasMore = true;

  // For incremental sync, allow catching up large backlogs
  // Fetch up to 100k activities per sync cycle
  const maxNewActivities = 100000;

  while (hasMore && activities.length < maxNewActivities) {
    const query = `
      query GetNewActivities($limit: Int!, $offset: Int!, $metadata: String!, $sinceVersion: bigint!) {
        fungible_asset_activities(
          where: {
            asset_type: {_eq: $metadata},
            transaction_version: {_gt: $sinceVersion}
          }
          order_by: {transaction_version: asc}
          limit: $limit
          offset: $offset
        ) {
          owner_address
          type
          amount
          transaction_version
          transaction_timestamp
          event_index
        }
      }
    `;

    try {
      const response = await fetch(aptosClient['config'].APTOS_INDEXER_URL!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(aptosClient['config'].APTOS_API_KEY
            ? { Authorization: `Bearer ${aptosClient['config'].APTOS_API_KEY}` }
            : {}),
        },
        body: JSON.stringify({
          query,
          variables: {
            limit: pageSize,
            offset,
            metadata: SHELBYUSD_METADATA,
            sinceVersion: sinceVersion.toString(),
          },
        }),
      });

      const result = await response.json();

      if (result.errors) {
        logger.warn({ errors: result.errors }, 'GraphQL query returned errors');
        break;
      }

      const fetched = result.data?.fungible_asset_activities || [];

      if (fetched.length === 0) {
        hasMore = false;
        break;
      }

      for (const activity of fetched) {
        // Parse blockchain timestamp (ISO string) to milliseconds
        const txTimestamp = activity.transaction_timestamp
          ? new Date(activity.transaction_timestamp).getTime()
          : Date.now();

        activities.push({
          transaction_version: parseInt(activity.transaction_version, 10),
          event_index: activity.event_index || 0,
          address: activity.owner_address,
          amount: parseInt(activity.amount || '0', 10),
          type: parseActivityType(activity.type),
          timestamp: txTimestamp,
        });
      }

      offset += pageSize;

      if (fetched.length < pageSize) {
        hasMore = false;
      }
    } catch (error) {
      logger.error({ error, offset }, 'Failed to fetch activities page');
      break;
    }
  }

  return activities;
}

/**
 * Fetch ALL activities (for full sync)
 * This is expensive - use only for initial sync or recovery
 */
async function fetchAllActivities(aptosClient: ShelbyAptosClient): Promise<ActivityRecord[]> {
  const activities: ActivityRecord[] = [];
  const pageSize = 100;
  let offset = 0;
  let hasMore = true;
  const maxResults = 500000; // Safety limit

  logger.info('Fetching all activities for full sync...');

  while (hasMore && activities.length < maxResults) {
    const query = `
      query GetAllActivities($limit: Int!, $offset: Int!, $metadata: String!) {
        fungible_asset_activities(
          where: {asset_type: {_eq: $metadata}}
          order_by: {transaction_version: asc}
          limit: $limit
          offset: $offset
        ) {
          owner_address
          type
          amount
          transaction_version
          transaction_timestamp
          event_index
        }
      }
    `;

    try {
      const response = await fetch(aptosClient['config'].APTOS_INDEXER_URL!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(aptosClient['config'].APTOS_API_KEY
            ? { Authorization: `Bearer ${aptosClient['config'].APTOS_API_KEY}` }
            : {}),
        },
        body: JSON.stringify({
          query,
          variables: {
            limit: pageSize,
            offset,
            metadata: SHELBYUSD_METADATA,
          },
        }),
      });

      const result = await response.json();

      if (result.errors) {
        logger.warn({ errors: result.errors }, 'GraphQL query returned errors');
        break;
      }

      const fetched = result.data?.fungible_asset_activities || [];

      if (fetched.length === 0) {
        hasMore = false;
        break;
      }

      for (const activity of fetched) {
        // Parse blockchain timestamp (ISO string) to milliseconds
        const txTimestamp = activity.transaction_timestamp
          ? new Date(activity.transaction_timestamp).getTime()
          : Date.now();

        activities.push({
          transaction_version: parseInt(activity.transaction_version, 10),
          event_index: activity.event_index || 0,
          address: activity.owner_address,
          amount: parseInt(activity.amount || '0', 10),
          type: parseActivityType(activity.type),
          timestamp: txTimestamp,
        });
      }

      offset += pageSize;

      // Log progress every 10k activities
      if (activities.length % 10000 === 0) {
        logger.info({ fetched: activities.length }, 'Full sync progress');
      }

      if (fetched.length < pageSize) {
        hasMore = false;
      }
    } catch (error) {
      logger.error({ error, offset }, 'Failed to fetch activities page during full sync');
      break;
    }
  }

  logger.info({ totalFetched: activities.length }, 'Finished fetching all activities');
  return activities;
}

/**
 * Parse activity type from GraphQL response
 */
function parseActivityType(typeStr: string): 'deposit' | 'withdraw' | 'mint' | 'burn' {
  const lower = typeStr.toLowerCase();
  if (lower.includes('withdraw')) return 'withdraw';
  if (lower.includes('mint')) return 'mint';
  if (lower.includes('burn')) return 'burn';
  return 'deposit';
}

/**
 * Get sync status for monitoring
 */
export function getSyncStatus(): {
  initialSyncComplete: boolean;
  syncInProgress: boolean;
  dbStats: ReturnType<typeof getDatabaseStats>;
} {
  return {
    initialSyncComplete,
    syncInProgress,
    dbStats: getDatabaseStats(),
  };
}
