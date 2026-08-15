import type { ShelbyAptosClient } from '../aptos-client';
import { logger } from '../logger';
import { getAllTimeAggregates, getActivityCount, getLastSyncedVersion } from '../db';

export interface AllTimeStats {
  totalSupply: number; // Total ShelbyUSD in circulation
  totalHolders: number; // Number of addresses holding ShelbyUSD
  totalTransactions: number; // All-time transaction count
  totalVolume: number; // All-time volume (sum of all transfers)
  averageTransactionSize: number; // Average amount per transaction
  firstTransactionVersion: string; // Earliest transaction on ShelbyNet
  lastTransactionVersion: string; // Most recent transaction
}

/**
 * Check if database has data
 */
function useDatabase(): boolean {
  try {
    return getActivityCount() > 0;
  } catch {
    return false;
  }
}

/**
 * Get comprehensive all-time statistics for ShelbyUSD on ShelbyNet
 * Uses database when available for instant response, falls back to API
 */
export async function getAllTimeStats(
  aptosClient: ShelbyAptosClient
): Promise<AllTimeStats> {
  try {
    // Try database first (instant query)
    if (useDatabase()) {
      const dbAggregates = getAllTimeAggregates();
      const lastVersion = getLastSyncedVersion();

      // Still need to fetch balances for current supply/holders (changes frequently)
      // But this is just one paginated query, not 1000
      const balances = await aptosClient.getShelbyUSDBalances(10000);
      const totalSupply = balances.reduce((sum, b) => sum + b.balance, 0);
      const totalHolders = balances.filter(b => b.balance > 0).length;

      // Calculate total volume from DB aggregates
      // Volume = all token movement (deposits include faucet mints)
      // Note: On ShelbyNet, faucet mints appear as Deposit events
      const totalVolume = dbAggregates.totalDeposited + dbAggregates.totalWithdrawn + dbAggregates.totalMinted + dbAggregates.totalBurned;
      const averageTransactionSize = dbAggregates.totalTransactions > 0
        ? totalVolume / dbAggregates.totalTransactions
        : 0;

      logger.info(
        {
          totalSupply,
          totalHolders,
          totalTransactions: dbAggregates.totalTransactions,
          totalVolume,
          source: 'database',
        },
        'Calculated all-time ShelbyUSD stats from database'
      );

      return {
        totalSupply,
        totalHolders,
        totalTransactions: dbAggregates.totalTransactions,
        totalVolume,
        averageTransactionSize,
        firstTransactionVersion: '0', // Could query DB for MIN if needed
        lastTransactionVersion: lastVersion.toString(),
      };
    }

    // Fallback: fetch from API (expensive)
    logger.info('Database empty, fetching all-time stats from API (slow)');
    const [balances, activities] = await Promise.all([
      aptosClient.getShelbyUSDBalances(10000),
      aptosClient.getShelbyUSDActivities(10000),
    ]);

    const totalSupply = balances.reduce((sum, b) => sum + b.balance, 0);
    const totalHolders = balances.filter(b => b.balance > 0).length;
    const totalTransactions = activities.length;

    const uniqueTransfers = new Map<string, number>();
    for (const activity of activities) {
      if (!uniqueTransfers.has(activity.version)) {
        uniqueTransfers.set(activity.version, activity.amount);
      }
    }
    const totalVolume = Array.from(uniqueTransfers.values()).reduce((sum, amt) => sum + amt, 0);
    const averageTransactionSize = totalTransactions > 0 ? totalVolume / totalTransactions : 0;

    const sortedActivities = [...activities].sort((a, b) =>
      parseInt(a.version) - parseInt(b.version)
    );
    const firstTransactionVersion = sortedActivities[0]?.version || '0';
    const lastTransactionVersion = sortedActivities[sortedActivities.length - 1]?.version || '0';

    logger.info(
      { totalSupply, totalHolders, totalTransactions, totalVolume, source: 'api' },
      'Calculated all-time ShelbyUSD stats from API'
    );

    return {
      totalSupply,
      totalHolders,
      totalTransactions,
      totalVolume,
      averageTransactionSize,
      firstTransactionVersion,
      lastTransactionVersion,
    };
  } catch (error) {
    logger.error({ error }, 'Failed to calculate all-time stats');
    return {
      totalSupply: 0,
      totalHolders: 0,
      totalTransactions: 0,
      totalVolume: 0,
      averageTransactionSize: 0,
      firstTransactionVersion: '0',
      lastTransactionVersion: '0',
    };
  }
}
