import NodeCache from "node-cache";
import type { ApiConfig } from "./config";
import { ShelbyAptosClient, type BlobEvent, type StorageProvider } from "./aptos-client";
import { logger } from "./logger";
import { getShelbyUSDLeaderboard, type LeaderboardEntry } from "./shelbyusd/leaderboard";
import { get24hVolume, type VolumeData } from "./shelbyusd/volume";
import { getMostActiveUsers, getBiggestSpenders, getRecentTransactions, clearActivityCache, type ActivityEntry, type SpenderEntry, type RecentTransaction } from "./shelbyusd/activity";
import { getAllTimeStats, type AllTimeStats } from "./shelbyusd/all-time-stats";
import { initDatabase, closeDatabase, getDatabaseStats, resetDatabase, getBlobSyncStats, getBlobStatsByType, getBlobStatsByOwner, getActivityBreakdown, get24hActivityStats, get24hBlobStats, getTopUploaders } from "./db";
import { incrementalSync, fullSync, getSyncStatus, isInitialSyncComplete } from "./sync-service";
import { incrementalBlobSync, getBlobSyncStatus } from "./blob-sync-service";
import { getAnalyticsData, computeAnalyticsFromEvents, type AnalyticsData } from "./analytics-service";

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

export interface NetworkActivityMetrics {
  // Activity breakdown (for pie chart)
  activityBreakdown: {
    deposits: number;
    withdrawals: number;
    mints: number;
    burns: number;
    total: number;
  };
  // 24h ShelbyUSD activity stats
  activity24h: {
    uniqueWallets: number;
    transactionCount: number;
    totalVolume: number;
    avgTxSize: number;
  };
  // 24h storage activity stats
  storage24h: {
    blobCount: number;
    totalBytes: number;
    uniqueUploaders: number;
    avgBlobSize: number;
  };
  // Top uploaders by storage
  topUploaders: Array<{
    address: string;
    addressShort: string;
    blobCount: number;
    totalBytes: number;
    totalBytesFormatted: string;
    avgBlobSize: number;
    topFileType: string | null;
  }>;
}

export interface EconomyData {
  leaderboard: LeaderboardEntry[];
  volume: VolumeData;
  allTimeStats: AllTimeStats;
  mostActive: ActivityEntry[];
  topSpenders: SpenderEntry[];
  recentTransactions: RecentTransaction[];
  networkActivity: NetworkActivityMetrics;
  timestamp: number;
}

export class DataService {
  private cache: NodeCache;
  private aptosClient: ShelbyAptosClient;
  private config: ApiConfig;
  private lastBlobCount = 0;
  private lastTimestamp = Date.now();
  private syncInterval: NodeJS.Timeout | null = null;

  // Request coalescing: prevent duplicate in-flight requests
  private inFlightRequests: Map<string, Promise<unknown>> = new Map();

  constructor(config: ApiConfig) {
    this.config = config;
    this.cache = new NodeCache({
      stdTTL: config.CACHE_TTL_SECONDS,
      checkperiod: config.CACHE_TTL_SECONDS * 2,
    });
    this.aptosClient = new ShelbyAptosClient(config);

    // Initialize database
    initDatabase();
    logger.info('Database initialized');

    // Start background sync
    this.startBackgroundSync();
  }

  /**
   * Start background incremental sync (runs every 30 seconds)
   */
  private startBackgroundSync(): void {
    // Run initial sync immediately
    this.runSync().catch(err => {
      logger.error({ err }, 'Initial sync failed');
    });

    // Then run every 30 seconds
    this.syncInterval = setInterval(() => {
      this.runSync().catch(err => {
        logger.error({ err }, 'Background sync failed');
      });
    }, 30000);

    logger.info('Background sync started (30s interval)');
  }

  /**
   * Run incremental sync for both blob events AND ShelbyUSD activities
   * Blob sync runs first to prioritize accurate blob counts
   */
  private async runSync(): Promise<void> {
    // Blob event sync FIRST - prioritize blob counts for Metrics tab
    try {
      await incrementalBlobSync(this.aptosClient);
    } catch (err) {
      logger.error({ err }, 'Blob sync failed');
    }

    // ShelbyUSD activity sync (for Economy tab)
    const dbStats = getDatabaseStats();
    if (dbStats.activityCount === 0) {
      logger.info('Database empty, performing full ShelbyUSD sync...');
      await fullSync(this.aptosClient);
    } else {
      await incrementalSync(this.aptosClient);
    }
  }

  /**
   * Get sync status for monitoring
   */
  getSyncStatus() {
    return {
      ...getSyncStatus(),
      blobSync: getBlobSyncStatus(),
    };
  }

  /**
   * Force a full resync (admin operation)
   */
  async forceResync(): Promise<number> {
    logger.info('Force resync requested');
    this.cache.del('economy_data');
    clearActivityCache();
    return fullSync(this.aptosClient);
  }

  /**
   * Shutdown - cleanup resources
   */
  shutdown(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    closeDatabase();
    logger.info('DataService shutdown complete');
  }

  /**
   * Coalesce identical requests to prevent thundering herd
   * Multiple users requesting same data will share one in-flight request
   */
  private async coalesce<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    // Return in-flight request if one exists
    const existing = this.inFlightRequests.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    // Create new request and track it
    const promise = fetcher().finally(() => {
      this.inFlightRequests.delete(key);
    });

    this.inFlightRequests.set(key, promise);
    return promise;
  }

  /**
   * Get network statistics with caching
   * Uses local SQLite database for accurate counts (synced incrementally)
   */
  async getNetworkStats(): Promise<NetworkStats> {
    const cacheKey = "network_stats";
    const cached = this.cache.get<NetworkStats>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Use local database for accurate counts
      const blobStats = getBlobSyncStats();
      const totalBlobs = blobStats.totalBlobs;
      const totalStorage = blobStats.totalStorage;

      // Calculate upload rate (blobs per minute)
      const now = Date.now();
      const timeDiff = (now - this.lastTimestamp) / 1000 / 60; // minutes
      const blobDiff = totalBlobs - this.lastBlobCount;
      const uploadRate =
        timeDiff > 0 && blobDiff > 0 ? blobDiff / timeDiff : 0;

      this.lastBlobCount = totalBlobs;
      this.lastTimestamp = now;

      const stats: NetworkStats = {
        totalBlobs,
        totalStorage,
        totalStorageFormatted: this.formatBytes(totalStorage),
        uploadRate,
        timestamp: now,
      };

      // Cache network stats for 30 seconds (data is from local DB, cheap to query)
      this.cache.set(cacheKey, stats, 30);
      return stats;
    } catch (error) {
      logger.error({ error }, "Failed to fetch network stats");
      throw error;
    }
  }

  /**
   * Get recent blob events
   */
  async getRecentBlobs(limit = 20): Promise<BlobData[]> {
    const cacheKey = `recent_blobs_${limit}`;
    const cached = this.cache.get<BlobData[]>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const events = await this.aptosClient.fetchBlobEvents(limit);

      const blobs: BlobData[] = events.map((event) => {
        // Parse Shelby event data structure
        const sizeBytes = Number.parseInt(event.data?.size_bytes || "0", 10);
        const expirationMicros = Number.parseInt(
          event.data?.expiration_micros || "0",
          10,
        );
        const expirationDate = new Date(expirationMicros / 1000);

        return {
          id: event.data?.blob_commitment || event.sequence_number,
          owner: this.shortenAddress(event.data?.owner || "unknown"),
          name: event.data?.blob_id?.split('/').pop() || this.generateBlobName(event.sequence_number),
          encoding: typeof event.data?.encoding === 'string' ? event.data.encoding : 'unknown',
          expires: expirationDate.toLocaleDateString("en-US"),
          size: this.formatBytes(sizeBytes),
          sizeBytes,
          version: event.version,
        };
      });

      this.cache.set(cacheKey, blobs);
      return blobs;
    } catch (error) {
      logger.error({ error }, "Failed to fetch recent blobs");
      throw error;
    }
  }

  /**
   * Get storage providers with extended caching
   * Providers don't change often, so cache longer
   */
  async getStorageProviders(): Promise<StorageProvider[]> {
    const cacheKey = "storage_providers";
    const cached = this.cache.get<StorageProvider[]>(cacheKey);
    if (cached) {
      return cached;
    }

    return this.coalesce(cacheKey, async () => {
      try {
        const providers = await this.aptosClient.fetchStorageProviders();
        // Cache for 5 minutes (300s) - providers rarely change
        this.cache.set(cacheKey, providers, 300);
        return providers;
      } catch (error) {
        logger.error({ error }, "Failed to fetch storage providers");
        throw error;
      }
    });
  }

  /**
   * Get all blob events (for activity feed)
   * Cached for 15 seconds to reduce load while keeping feed fresh
   */
  async getAllBlobEvents(limit = 100): Promise<BlobEvent[]> {
    const cacheKey = `all_events_${limit}`;
    const cached = this.cache.get<BlobEvent[]>(cacheKey);
    if (cached) {
      return cached;
    }

    return this.coalesce(cacheKey, async () => {
      try {
        const events = await this.aptosClient.fetchBlobEvents(limit);
        // Cache for 15 seconds - balances freshness vs cost
        this.cache.set(cacheKey, events, 15);
        return events;
      } catch (error) {
        logger.error({ error }, "Failed to fetch blob events");
        throw error;
      }
    });
  }

  /**
   * Health check - lightweight, used for latency monitoring
   */
  async healthCheck(): Promise<{ status: string; timestamp: number }> {
    try {
      // Lightweight check: just fetch 1 recent event to verify indexer connection
      await this.aptosClient.fetchBlobEvents(1);
      return {
        status: "healthy",
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error({ error }, "Health check failed");
      return {
        status: "unhealthy",
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Get ShelbyUSD economy data with caching and request coalescing
   * Includes all-time stats since ShelbyNet (devnet) inception
   */
  async getEconomyData(forceRefresh = false): Promise<EconomyData> {
    const cacheKey = "economy_data";

    // If forcing refresh, clear the activity cache too
    if (forceRefresh) {
      clearActivityCache();
      this.cache.del(cacheKey);
    } else {
      const cached = this.cache.get<EconomyData>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Use coalescing to prevent duplicate requests when 100+ users hit simultaneously
    return this.coalesce(cacheKey, async () => {
      try {
        const [leaderboard, volume, allTimeStats, mostActive, topSpenders, recentTransactions] = await Promise.all([
          getShelbyUSDLeaderboard(this.aptosClient, 20),
          get24hVolume(this.aptosClient),
          getAllTimeStats(this.aptosClient),
          getMostActiveUsers(this.aptosClient, 10),
          getBiggestSpenders(this.aptosClient, 10),
          getRecentTransactions(this.aptosClient, 20),
        ]);

        // Get network activity metrics from local database (fast, no API calls)
        const activityBreakdown = getActivityBreakdown();
        const activity24h = get24hActivityStats();
        const storage24h = get24hBlobStats();
        const topUploadersRaw = getTopUploaders(10);

        // Format top uploaders with human-readable values
        const topUploaders = topUploadersRaw.map(uploader => ({
          ...uploader,
          addressShort: this.shortenAddress(uploader.address),
          totalBytesFormatted: this.formatBytes(uploader.totalBytes),
        }));

        const networkActivity: NetworkActivityMetrics = {
          activityBreakdown,
          activity24h,
          storage24h,
          topUploaders,
        };

        const economyData: EconomyData = {
          leaderboard,
          volume,
          allTimeStats,
          mostActive,
          topSpenders,
          recentTransactions,
          networkActivity,
          timestamp: Date.now(),
        };

        // Cache economy data for 60 seconds (was 30s) - reduces API costs by 50%
        this.cache.set(cacheKey, economyData, 60);
        return economyData;
      } catch (error) {
        logger.error({ error }, "Failed to fetch economy data");
        throw error;
      }
    });
  }

  /**
   * Get user's recent ShelbyUSD deposits with transaction hashes
   * Used for showing toast notifications with explorer links
   */
  async getUserDeposits(
    userAddress: string,
    sinceVersion?: string,
    limit = 10
  ): Promise<Array<{
    txHash: string;
    amount: number;
    version: string;
  }>> {
    return this.aptosClient.getUserShelbyUSDDeposits(userAddress, sinceVersion, limit);
  }

  /**
   * Get storage analytics - file types, top storage users
   * Uses local SQLite database for accurate data (synced incrementally)
   */
  async getAnalytics(): Promise<AnalyticsData> {
    const cacheKey = "analytics_data";
    const cached = this.cache.get<AnalyticsData>(cacheKey);
    if (cached) {
      return cached;
    }

    return this.coalesce(cacheKey, async () => {
      try {
        // Get data from local database (accurate, no rate limits)
        const blobStats = getBlobSyncStats();
        const fileTypesData = getBlobStatsByType();
        const topOwners = getBlobStatsByOwner(10);

        // Map file type stats to analytics format (matching FileTypeStats interface)
        const fileTypes = fileTypesData.map(ft => ({
          extension: ft.file_type,
          count: ft.count,
          totalSize: ft.total_bytes,
          totalSizeFormatted: this.formatBytes(ft.total_bytes),
          percentage: blobStats.totalBlobs > 0 ? (ft.count / blobStats.totalBlobs) * 100 : 0,
          color: '#7F8C8D', // Default color
        }));

        // Map owner stats to analytics format (matching StorageLeader interface)
        const storageLeaders = topOwners.map(owner => ({
          address: owner.owner_address,
          addressShort: this.shortenAddress(owner.owner_address),
          blobCount: owner.blob_count,
          totalSize: owner.total_bytes,
          totalSizeFormatted: this.formatBytes(owner.total_bytes),
          fileTypes: [] as string[],
        }));

        // Calculate average blob size
        const avgSize = blobStats.totalBlobs > 0 ? blobStats.totalStorage / blobStats.totalBlobs : 0;

        const analytics: AnalyticsData = {
          fileTypes,
          storageLeaders,
          totalBlobs: blobStats.totalBlobs,
          totalSize: blobStats.totalStorage,
          totalSizeFormatted: this.formatBytes(blobStats.totalStorage),
          avgBlobSize: avgSize,
          avgBlobSizeFormatted: this.formatBytes(avgSize),
          uniqueOwners: blobStats.uniqueOwners,
          blobsPerHour: 0, // TODO: calculate from timestamps
          bytesPerHour: 0,
          bytesPerHourFormatted: '0 B/hr',
          timestamp: Date.now(),
        };

        // Cache for 30 seconds (local DB query is cheap)
        this.cache.set(cacheKey, analytics, 30);

        logger.info({
          totalBlobs: analytics.totalBlobs,
          totalStorage: analytics.totalSize,
          uniqueOwners: analytics.uniqueOwners,
          syncedFromDB: true,
        }, "Analytics computed from local database");

        return analytics;
      } catch (error) {
        logger.error({ error }, "Failed to compute analytics from database");
        throw error;
      }
    });
  }

  /**
   * Clear cache (useful for debugging)
   */
  clearCache(): void {
    this.cache.flushAll();
    logger.info("Cache cleared");
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }

  private shortenAddress(address: string): string {
    if (address.length <= 12) return address;
    return `${address.slice(0, 6)}...${address.slice(-5)}`;
  }

  private generateBlobName(id: string): string {
    // Generate a more friendly name based on blob ID
    const fileNames = [
      "contract_data.json",
      "nft_metadata.json",
      "user_avatar.png",
      "game_state.dat",
      "backup.zip",
      "config.yaml",
      "image.jpg",
      "transaction_log.txt",
      "storage_proof.bin",
      "blockchain_snapshot.db",
    ];

    // Use the ID to deterministically pick a name
    const hash = id.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return fileNames[hash % fileNames.length];
  }
}
