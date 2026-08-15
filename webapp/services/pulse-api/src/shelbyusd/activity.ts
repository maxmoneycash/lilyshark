import type { ShelbyAptosClient } from '../aptos-client';
import { logger } from '../logger';
import {
  getTopByTxCount,
  getTopSpenders as getTopSpendersFromDb,
  getTopMinters as getTopMintersFromDb,
  getRecentActivities,
  getActivityCount,
  type AddressStatsRecord,
} from '../db';

export interface ActivityEntry {
  address: string;
  txCount: number;
  barWidth: number;
}

export interface SpenderEntry {
  address: string;
  totalSpent: number;
  barWidth: number;
}

export interface RecentTransaction {
  address: string;
  type: 'deposit' | 'withdraw' | 'mint' | 'burn';
  amount: number;
  version: number;
}

export interface MinterEntry {
  address: string;
  totalMinted: number;
  mintCount: number;
  barWidth: number;
}

// Legacy cache for fallback when DB is empty
let cachedActivities: Array<{
  owner: string;
  type: 'deposit' | 'withdraw' | 'mint' | 'burn';
  amount: number;
  version: string;
}> | null = null;
let cacheTimestamp = 0;
const ACTIVITY_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Check if database has data (use DB-backed queries)
 */
function useDatabase(): boolean {
  try {
    return getActivityCount() > 0;
  } catch {
    return false;
  }
}

/**
 * Get cached activities or fetch fresh data (legacy fallback)
 */
async function getCachedActivities(aptosClient: ShelbyAptosClient, forceRefresh = false): Promise<typeof cachedActivities> {
  const now = Date.now();

  if (!forceRefresh && cachedActivities && (now - cacheTimestamp) < ACTIVITY_CACHE_TTL_MS) {
    return cachedActivities;
  }

  logger.info('Fetching all ShelbyUSD activities (legacy fallback)');
  cachedActivities = await aptosClient.getShelbyUSDActivities(100000);
  cacheTimestamp = now;

  return cachedActivities;
}

/**
 * Clear the activity cache
 */
export function clearActivityCache(): void {
  cachedActivities = null;
  cacheTimestamp = 0;
  logger.info('Activity cache cleared');
}

/**
 * Get most active ShelbyUSD users by transaction count
 * Uses database when available, falls back to legacy API fetching
 */
export async function getMostActiveUsers(
  aptosClient: ShelbyAptosClient,
  limit = 10
): Promise<ActivityEntry[]> {
  try {
    // Try database first (instant query)
    if (useDatabase()) {
      const dbResults = getTopByTxCount(limit);
      if (dbResults.length > 0) {
        const maxCount = dbResults[0].tx_count;
        return dbResults.map(row => ({
          address: row.address,
          txCount: row.tx_count,
          barWidth: Math.max(1, Math.floor((row.tx_count / maxCount) * 20)),
        }));
      }
    }

    // Fallback to legacy API fetching
    const activities = await getCachedActivities(aptosClient);
    if (!activities) return [];

    const txCounts = new Map<string, number>();
    for (const activity of activities) {
      const count = txCounts.get(activity.owner) || 0;
      txCounts.set(activity.owner, count + 1);
    }

    const entries = Array.from(txCounts.entries())
      .map(([address, txCount]) => ({ address, txCount }))
      .sort((a, b) => b.txCount - a.txCount)
      .slice(0, limit);

    const maxCount = entries.length > 0 ? entries[0].txCount : 1;
    return entries.map(entry => ({
      address: entry.address,
      txCount: entry.txCount,
      barWidth: Math.max(1, Math.floor((entry.txCount / maxCount) * 20)),
    }));
  } catch (error) {
    logger.error({ error }, 'Failed to get most active users');
    return [];
  }
}

/**
 * Get biggest ShelbyUSD spenders by total withdraw amount
 * Uses database when available, falls back to legacy API fetching
 */
export async function getBiggestSpenders(
  aptosClient: ShelbyAptosClient,
  limit = 10
): Promise<SpenderEntry[]> {
  try {
    // Try database first (instant query)
    if (useDatabase()) {
      const dbResults = getTopSpendersFromDb(limit);
      if (dbResults.length > 0) {
        const maxSpent = dbResults[0].total_withdrawn;
        return dbResults.map(row => ({
          address: row.address,
          totalSpent: row.total_withdrawn,
          barWidth: Math.max(1, Math.floor((row.total_withdrawn / maxSpent) * 20)),
        }));
      }
    }

    // Fallback to legacy API fetching
    const activities = await getCachedActivities(aptosClient);
    if (!activities) return [];

    const withdrawals = new Map<string, number>();
    for (const activity of activities) {
      if (activity.type === 'withdraw') {
        const current = withdrawals.get(activity.owner) || 0;
        withdrawals.set(activity.owner, current + activity.amount);
      }
    }

    const entries = Array.from(withdrawals.entries())
      .map(([address, totalSpent]) => ({ address, totalSpent }))
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, limit);

    const maxSpent = entries.length > 0 ? entries[0].totalSpent : 1;
    return entries.map(entry => ({
      address: entry.address,
      totalSpent: entry.totalSpent,
      barWidth: Math.max(1, Math.floor((entry.totalSpent / maxSpent) * 20)),
    }));
  } catch (error) {
    logger.error({ error }, 'Failed to get biggest spenders');
    return [];
  }
}

/**
 * Get top ShelbyUSD minters (airdrop eligible addresses)
 * Uses database when available, falls back to legacy API fetching
 */
export async function getTopMinters(
  aptosClient: ShelbyAptosClient,
  limit = 10
): Promise<MinterEntry[]> {
  try {
    // Try database first (instant query)
    if (useDatabase()) {
      const dbResults = getTopMintersFromDb(limit);
      if (dbResults.length > 0) {
        const maxMinted = dbResults[0].total_minted;
        // Note: DB doesn't track mint count separately, estimate from tx_count
        return dbResults.map(row => ({
          address: row.address,
          totalMinted: row.total_minted,
          mintCount: row.tx_count, // Approximation
          barWidth: Math.max(1, Math.floor((row.total_minted / maxMinted) * 20)),
        }));
      }
    }

    // Fallback to legacy API fetching
    const activities = await getCachedActivities(aptosClient);
    if (!activities) return [];

    const mints = new Map<string, { totalMinted: number; mintCount: number }>();
    for (const activity of activities) {
      if (activity.type === 'mint') {
        const current = mints.get(activity.owner) || { totalMinted: 0, mintCount: 0 };
        mints.set(activity.owner, {
          totalMinted: current.totalMinted + activity.amount,
          mintCount: current.mintCount + 1,
        });
      }
    }

    const entries = Array.from(mints.entries())
      .map(([address, data]) => ({ address, ...data }))
      .sort((a, b) => b.totalMinted - a.totalMinted)
      .slice(0, limit);

    const maxMinted = entries.length > 0 ? entries[0].totalMinted : 1;
    return entries.map(entry => ({
      address: entry.address,
      totalMinted: entry.totalMinted,
      mintCount: entry.mintCount,
      barWidth: Math.max(1, Math.floor((entry.totalMinted / maxMinted) * 20)),
    }));
  } catch (error) {
    logger.error({ error }, 'Failed to get top minters');
    return [];
  }
}

/**
 * Get recent ShelbyUSD transactions
 * Uses database when available, falls back to API
 */
export async function getRecentTransactions(
  aptosClient: ShelbyAptosClient,
  limit = 20
): Promise<RecentTransaction[]> {
  try {
    // Try database first (instant query)
    if (useDatabase()) {
      const dbResults = getRecentActivities(limit);
      if (dbResults.length > 0) {
        return dbResults.map(row => ({
          address: row.address,
          type: row.type,
          amount: row.amount,
          version: row.transaction_version,
        }));
      }
    }

    // Fallback to API
    const activities = await aptosClient.getShelbyUSDActivities(limit);
    return activities.map(activity => ({
      address: activity.owner,
      type: activity.type,
      amount: activity.amount,
      version: parseInt(activity.version),
    }));
  } catch (error) {
    logger.error({ error }, 'Failed to get recent transactions');
    return [];
  }
}
