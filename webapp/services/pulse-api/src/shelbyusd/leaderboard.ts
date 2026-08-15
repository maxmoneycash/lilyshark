import type { ShelbyAptosClient, ShelbyUSDEvent } from '../aptos-client';
import { logger } from '../logger';

export interface LeaderboardEntry {
  address: string;
  balance: number;
  barWidth: number; // 0-20 for ASCII bar visualization
}

/**
 * Get top ShelbyUSD holders from current balances table
 * Queries ALL balances on ShelbyNet
 */
export async function getShelbyUSDLeaderboard(
  aptosClient: ShelbyAptosClient,
  limit = 20
): Promise<LeaderboardEntry[]> {
  try {
    // Fetch ALL ShelbyUSD balances on ShelbyNet (increased limit to capture all holders)
    const balances = await aptosClient.getShelbyUSDBalances(10000);

    if (balances.length === 0) {
      return [];
    }

    // Calculate bar widths for ASCII visualization
    const maxBalance = balances[0].balance;
    const leaderboard = balances.map(entry => ({
      address: entry.owner,
      balance: entry.balance,
      barWidth: Math.max(1, Math.floor((entry.balance / maxBalance) * 20)),
    }));

    logger.debug(
      { topHolders: leaderboard.length },
      'Generated ShelbyUSD leaderboard'
    );

    return leaderboard;
  } catch (error) {
    logger.error({ error }, 'Failed to generate ShelbyUSD leaderboard');
    return [];
  }
}
