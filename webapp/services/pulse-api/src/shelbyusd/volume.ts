import type { ShelbyAptosClient } from '../aptos-client';
import { logger } from '../logger';
import { getDatabase, getActivityCount } from '../db';

export interface VolumeData {
  volume24h: number;
  transferCount24h: number;
  velocity: number; // transfers per hour
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
 * Calculate 24-hour volume and velocity for ShelbyUSD
 * Uses database for accurate time-based filtering when available
 */
export async function get24hVolume(
  aptosClient: ShelbyAptosClient
): Promise<VolumeData> {
  try {
    // Try database first - it has timestamps we can filter on
    if (useDatabase()) {
      const db = getDatabase();
      const oneDayAgoMs = Date.now() - 24 * 60 * 60 * 1000;

      // Query activities from last 24 hours (including mints!)
      const result = db.prepare(`
        SELECT
          SUM(amount) as total_volume,
          COUNT(*) as tx_count
        FROM shelbyusd_activities
        WHERE timestamp >= ?
      `).get(oneDayAgoMs) as { total_volume: number | null; tx_count: number };

      const totalVolume = result?.total_volume ?? 0;
      const transferCount = result?.tx_count ?? 0;
      const velocity = transferCount / 24;

      logger.debug(
        { volume24h: totalVolume, transferCount24h: transferCount, velocity, source: 'database' },
        'Calculated 24h ShelbyUSD volume from database'
      );

      return {
        volume24h: totalVolume,
        transferCount24h: transferCount,
        velocity,
      };
    }

    // Fallback to API (less accurate - no real timestamp filtering)
    const events = await aptosClient.getShelbyUSDEvents(5000);

    let totalVolume = 0;
    let transferCount = 0;
    const seenVersions = new Set<string>();

    for (const event of events) {
      if (!seenVersions.has(event.version)) {
        seenVersions.add(event.version);
        totalVolume += event.amount;
        transferCount++;
      }
    }

    const velocity = transferCount / 24;

    logger.debug(
      { volume24h: totalVolume, transferCount24h: transferCount, velocity, source: 'api' },
      'Calculated 24h ShelbyUSD volume from API'
    );

    return {
      volume24h: totalVolume,
      transferCount24h: transferCount,
      velocity,
    };
  } catch (error) {
    logger.error({ error }, 'Failed to calculate 24h volume');
    return {
      volume24h: 0,
      transferCount24h: 0,
      velocity: 0,
    };
  }
}
