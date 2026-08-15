import type { ShelbyAptosClient } from '../aptos-client';
import { logger } from '../logger';

export interface EarnerEntry {
  address: string;
  totalEarned: number;
  barWidth: number; // 0-20 for ASCII bar
}

/**
 * Get top earners (accounts with most deposits/read rewards)
 */
export async function getTopEarners(
  aptosClient: ShelbyAptosClient,
  limit = 10
): Promise<EarnerEntry[]> {
  try {
    const events = await aptosClient.getShelbyUSDEvents(10000);

    // Aggregate deposits (earnings) by account
    const earnings = new Map<string, number>();

    for (const event of events) {
      if (event.type === 'deposit') {
        const current = earnings.get(event.account) || 0;
        earnings.set(event.account, current + event.amount);
      }
    }

    // Convert to array and sort
    const entries = Array.from(earnings.entries())
      .map(([address, totalEarned]) => ({ address, totalEarned }))
      .sort((a, b) => b.totalEarned - a.totalEarned)
      .slice(0, limit);

    // Calculate bar widths
    const maxEarned = entries.length > 0 ? entries[0].totalEarned : 1;
    const earners = entries.map(entry => ({
      address: entry.address,
      totalEarned: entry.totalEarned,
      barWidth: Math.max(1, Math.floor((entry.totalEarned / maxEarned) * 20)),
    }));

    logger.debug(
      { totalEarners: earnings.size, topEarners: earners.length },
      'Generated top earners list'
    );

    return earners;
  } catch (error) {
    logger.error({ error }, 'Failed to get top earners');
    return [];
  }
}
