/**
 * Backend API client for Shelby Pulse
 * Fetches real data from the pulse-api service
 */

// Use Vercel serverless function catch-all proxy
const API_BASE_URL = '/api';

export interface NetworkStats {
  totalBlobs: number;
  totalStorage: number;
  totalStorageFormatted: string;
  uploadRate: number;
  timestamp: number;
}

export interface BlobData {
  id: string;
  owner: string;
  name: string;
  encoding: string;
  expires: string;
  size: string;
  sizeBytes: number;
  version: string;
}

export interface BlobEvent {
  type: string;
  data: {
    blob_commitment?: string;
    owner?: string;
    expiration_micros?: string;
    size_bytes?: string;
    encoding?: string;
    blob_id?: string;
  };
  version: string;
  sequence_number: string;
}

export interface LeaderboardEntry {
  address: string;
  balance: number;
  barWidth: number;
}

export interface VolumeData {
  volume24h: number;
  transferCount24h: number;
  velocity: number;
}

export interface EarnerEntry {
  address: string;
  totalEarned: number;
  barWidth: number;
}

export interface SpenderEntry {
  address: string;
  totalSpent: number;
  barWidth: number;
}

export interface EconomyData {
  leaderboard: LeaderboardEntry[];
  volume: VolumeData;
  topEarners: EarnerEntry[];
  topSpenders: SpenderEntry[];
  timestamp: number;
}

export interface StorageProvider {
  address: string;
  datacenter: string;
  chunks_stored: number;
  usage?: number;
}

export interface NodeInfo {
  id: number;
  name: string;
  status: string;
  ip?: string;
  createdAt: string;
  farmingStatus: 'pending' | 'running' | 'completed' | 'failed';
  farmedAmount: number;
  successfulRequests: number;
  failedRequests: number;
}

export interface FarmingSession {
  id: string;
  walletAddress: string;
  startedAt: string;
  droplets: NodeInfo[];
  totalFarmed: number;
  status: 'starting' | 'running' | 'completed' | 'stopped' | 'failed';
}

export interface FarmingOverview {
  totalSessions: number;
  activeSessions: number;
  totalDroplets: number;
  estimatedTotalFarmed: number;
}

export interface UserDeposit {
  txHash: string;
  amount: number;
  version: string;
}

// Continuous farming types
export interface ContinuousFarmingJobConfig {
  regions: string[];
  dropletsPerRegion: number;
  waveIntervalMs: number;
  maxWaves?: number;
}

export interface ContinuousFarmingJob {
  id: string;
  wallet_address: string;
  status: 'active' | 'paused' | 'stopped' | 'completed';
  started_at: number;
  stopped_at: number | null;
  total_minted: number;
  waves_completed: number;
  droplets_created: number;
  droplets_failed: number;
  last_wave_at: number | null;
  config: ContinuousFarmingJobConfig;
}

export interface ContinuousFarmingWave {
  id: number;
  job_id: string;
  wave_number: number;
  started_at: number;
  completed_at: number | null;
  regions: string[];
  droplets_per_region: number;
  total_droplets: number;
  droplets_succeeded: number;
  droplets_failed: number;
  estimated_minted: number;
}

export interface ContinuousFarmingStatus {
  active: boolean;
  job: ContinuousFarmingJob | null;
  waves?: ContinuousFarmingWave[];
  estimatedYield?: number;
  runningTime?: string;
}

export interface ContinuousFarmingSummary {
  activeJobs: number;
  totalJobs: number;
  totalMinted: number;
  totalWaves: number;
  totalDropletsCreated: number;
}

// Analytics types
export interface FileTypeStats {
  extension: string;
  count: number;
  totalSize: number;
  totalSizeFormatted: string;
  percentage: number;
  color: string;
}

export interface StorageLeader {
  address: string;
  addressShort: string;
  blobCount: number;
  totalSize: number;
  totalSizeFormatted: string;
  fileTypes: string[];
}

export interface AnalyticsData {
  fileTypes: FileTypeStats[];
  storageLeaders: StorageLeader[];
  totalBlobs: number;
  totalSize: number;
  totalSizeFormatted: string;
  uniqueOwners: number;
  // Growth metrics
  blobsPerHour: number;
  bytesPerHour: number;
  bytesPerHourFormatted: string;
  timestamp: number;
}

class BackendApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Fetch network statistics
   */
  async getNetworkStats(): Promise<NetworkStats> {
    const response = await fetch(`${this.baseUrl}/network/stats`);
    if (!response.ok) {
      throw new Error(`Failed to fetch network stats: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Fetch recent blobs
   */
  async getRecentBlobs(limit = 20): Promise<BlobData[]> {
    const response = await fetch(`${this.baseUrl}/blobs/recent?limit=${limit}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch recent blobs: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Fetch recent events
   */
  async getRecentEvents(limit = 100): Promise<BlobEvent[]> {
    const response = await fetch(`${this.baseUrl}/events/recent?limit=${limit}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch events: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Fetch economy data
   * @param forceRefresh - bypass cache to get fresh data
   */
  async getEconomy(forceRefresh = false): Promise<EconomyData> {
    const url = forceRefresh
      ? `${this.baseUrl}/economy?refresh=true`
      : `${this.baseUrl}/economy`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch economy data: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Health check
   */
  async health(): Promise<{ status: string; timestamp: number }> {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get storage analytics - file types and top storage users
   */
  async getAnalytics(): Promise<AnalyticsData> {
    const response = await fetch(`${this.baseUrl}/analytics`);
    if (!response.ok) {
      throw new Error(`Failed to fetch analytics: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get user's recent ShelbyUSD deposits with transaction hashes
   */
  async getUserDeposits(address: string, sinceVersion?: string, limit = 10): Promise<UserDeposit[]> {
    const params = new URLSearchParams({ address, limit: limit.toString() });
    if (sinceVersion) {
      params.append('since_version', sinceVersion);
    }
    const response = await fetch(`${this.baseUrl}/user/deposits?${params}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch user deposits: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Fetch storage providers
   */
  async getProviders(): Promise<StorageProvider[]> {
    const response = await fetch(`${this.baseUrl}/providers`);
    if (!response.ok) {
      throw new Error(`Failed to fetch providers: ${response.statusText}`);
    }
    return response.json();
  }

  // ============================================
  // FARMING API
  // ============================================

  /**
   * Start a farming session
   */
  async startFarming(walletAddress: string, numDroplets: number = 5): Promise<FarmingSession> {
    const response = await fetch(`${this.baseUrl}/farming/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress, numDroplets }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to start farming: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get farming status
   */
  async getFarmingStatus(sessionId?: string): Promise<FarmingSession | FarmingSession[]> {
    const url = sessionId
      ? `${this.baseUrl}/farming/status?sessionId=${sessionId}`
      : `${this.baseUrl}/farming/status`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to get farming status: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get farming overview
   */
  async getFarmingOverview(): Promise<FarmingOverview> {
    const response = await fetch(`${this.baseUrl}/farming/overview`);
    if (!response.ok) {
      throw new Error(`Failed to get farming overview: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Stop a farming session
   */
  async stopFarming(sessionId: string): Promise<{ message: string }> {
    const response = await fetch(`${this.baseUrl}/farming/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to stop farming: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Cleanup all farming nodes
   */
  async cleanupFarming(): Promise<{ message: string }> {
    const response = await fetch(`${this.baseUrl}/farming/cleanup`, {
      method: 'POST',
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to cleanup farming: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Clear old/failed sessions from memory
   */
  async clearSessions(): Promise<{ message: string }> {
    const response = await fetch(`${this.baseUrl}/farming/clear-sessions`, {
      method: 'POST',
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to clear sessions: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Request faucet directly
   */
  async requestFaucet(walletAddress: string): Promise<{ txn_hashes: string[] }> {
    const response = await fetch(`${this.baseUrl}/farming/faucet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to request faucet: ${response.statusText}`);
    }
    return response.json();
  }

  // ============================================
  // CONTINUOUS FARMING API
  // ============================================

  /**
   * Start a continuous farming job
   */
  async startContinuousFarming(
    walletAddress: string,
    config?: {
      regions?: string[];
      dropletsPerRegion?: number;
      waveIntervalMinutes?: number;
      maxWaves?: number;
    }
  ): Promise<ContinuousFarmingJob> {
    const response = await fetch(`${this.baseUrl}/farming/continuous/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress, ...config }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to start continuous farming: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get continuous farming status for a wallet
   */
  async getContinuousFarmingStatus(walletAddress: string): Promise<ContinuousFarmingStatus> {
    const response = await fetch(`${this.baseUrl}/farming/continuous/status?walletAddress=${walletAddress}`);
    if (!response.ok) {
      throw new Error(`Failed to get continuous farming status: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get continuous farming job status by ID
   */
  async getContinuousFarmingJobStatus(jobId: string): Promise<{
    job: ContinuousFarmingJob;
    waves: ContinuousFarmingWave[];
    estimatedYield: number;
    runningTime: string;
  }> {
    const response = await fetch(`${this.baseUrl}/farming/continuous/status?jobId=${jobId}`);
    if (!response.ok) {
      throw new Error(`Failed to get job status: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Stop a continuous farming job
   */
  async stopContinuousFarming(jobId: string): Promise<{ message: string }> {
    const response = await fetch(`${this.baseUrl}/farming/continuous/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to stop continuous farming: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get continuous farming history for a wallet
   */
  async getContinuousFarmingHistory(walletAddress: string): Promise<ContinuousFarmingJob[]> {
    const response = await fetch(`${this.baseUrl}/farming/continuous/history?walletAddress=${walletAddress}`);
    if (!response.ok) {
      throw new Error(`Failed to get farming history: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get available regions for continuous farming
   */
  async getContinuousFarmingRegions(): Promise<{ regions: string[] }> {
    const response = await fetch(`${this.baseUrl}/farming/continuous/regions`);
    if (!response.ok) {
      throw new Error(`Failed to get farming regions: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get global continuous farming summary
   */
  async getContinuousFarmingSummary(): Promise<ContinuousFarmingSummary> {
    const response = await fetch(`${this.baseUrl}/farming/continuous/status`);
    if (!response.ok) {
      throw new Error(`Failed to get farming summary: ${response.statusText}`);
    }
    return response.json();
  }
}

export const backendApi = new BackendApiClient();
