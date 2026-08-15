import type { ShelbyAptosClient } from '../aptos-client';
import { logger } from '../logger';

export interface SpenderEntry {
  address: string;
  totalSpent: number;
  barWidth: number; // 0-20 for ASCII bar
}

/**
 * Get top spenders (accounts with most withdraws/upload costs)
 */
export async function getTopSpenders(
  aptosClient: ShelbyAptosClient,
  limit = 10
): Promise<SpenderEntry[]> {
  try {
    const events = await aptosClient.getShelbyUSDEvents(10000);

    // Aggregate withdraws (spending) by account
    const spending = new Map<string, number>();

    for (const event of events) {
      if (event.type === 'withdraw') {
        const current = spending.get(event.account) || 0;
        spending.set(event.account, current + event.amount);
      }
    }

    // Convert to array and sort
    const entries = Array.from(spending.entries())
      .map(([address, totalSpent]) => ({ address, totalSpent }))
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, limit);

    // Calculate bar widths
    const maxSpent = entries.length > 0 ? entries[0].totalSpent : 1;
    const spenders = entries.map(entry => ({
      address: entry.address,
      totalSpent: entry.totalSpent,
      barWidth: Math.max(1, Math.floor((entry.totalSpent / maxSpent) * 20)),
    }));

    logger.debug(
      { totalSpenders: spending.size, topSpenders: spenders.length },
      'Generated top spenders list'
    );

    return spenders;
  } catch (error) {
    logger.error({ error }, 'Failed to get top spenders');
    return [];
  }
}
