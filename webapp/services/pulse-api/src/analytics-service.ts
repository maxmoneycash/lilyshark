import { logger } from './logger';
import type { ShelbyAptosClient, BlobEvent } from './aptos-client';

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
  avgBlobSize: number;
  avgBlobSizeFormatted: string;
  uniqueOwners: number;
  // Growth metrics
  blobsPerHour: number;
  bytesPerHour: number;
  bytesPerHourFormatted: string;
  timestamp: number;
}

// Color mapping for file type categories
const categoryColors: Record<string, string> = {
  'Images': '#FF69B4',
  'Documents': '#4A90E2',
  'Data': '#00C896',
  'Media': '#9B59B6',
  'Archives': '#E67E22',
  'Code': '#1ABC9C',
  'Ebooks': '#F39C12',
  'Binary': '#95A5A6',
  'Other': '#7F8C8D',
};

// Extract file extension from blob name
function getFileExtension(name: string): string {
  const match = name.match(/\.([a-zA-Z0-9]+)$/);
  if (!match) return 'unknown';
  return match[1].toLowerCase();
}

// Format bytes to human readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

// Shorten address for display
function shortenAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-5)}`;
}

// Categorize file extensions into broader types
function categorizeExtension(ext: string): string {
  const categories: Record<string, string[]> = {
    'Images': ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff'],
    'Documents': ['pdf', 'doc', 'docx', 'txt', 'md', 'html', 'htm', 'rtf', 'odt'],
    'Data': ['json', 'xml', 'csv', 'yaml', 'yml', 'toml', 'log', 'dat'],
    'Media': ['mp4', 'mp3', 'wav', 'avi', 'mov', 'mkv', 'flac', 'ogg', 'webm'],
    'Archives': ['zip', 'tar', 'gz', 'rar', '7z', 'bz2'],
    'Code': ['js', 'ts', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'css', 'scss'],
    'Ebooks': ['lit', 'epub', 'mobi', 'azw', 'azw3'],
    'Binary': ['bin', 'exe', 'dll', 'so', 'dylib'],
  };

  for (const [category, extensions] of Object.entries(categories)) {
    if (extensions.includes(ext)) return category;
  }
  return 'Other';
}

/**
 * Compute analytics from a pre-fetched list of events
 * This avoids making additional API calls that trigger rate limits
 */
export function computeAnalyticsFromEvents(
  events: BlobEvent[],
  totalBlobs: number,
  totalStorage: number
): AnalyticsData {
  // Aggregate by file type
  const fileTypeMap = new Map<string, { count: number; totalSize: number }>();

  // Aggregate by owner
  const ownerMap = new Map<string, {
    blobCount: number;
    totalSize: number;
    extensions: Set<string>;
  }>();

  // Track timestamps for growth calculation
  let oldestTimestamp = Infinity;
  let newestTimestamp = 0;
  let sampleTotalSize = 0;

  for (const event of events) {
    // blob_name format: @owner/filename.ext
    const rawName = event.data?.blob_name || event.data?.blob_id || event.data?.blob_commitment || '';
    const name = rawName.split('/').pop() || rawName;
    const owner = event.data?.owner || '';
    const sizeBytes = Number.parseInt(event.data?.blob_size || event.data?.size_bytes || '0', 10);

    sampleTotalSize += sizeBytes;

    // Track timestamps for growth rate
    const creationMicros = Number.parseInt(event.data?.creation_micros || '0', 10);
    if (creationMicros > 0) {
      const creationMs = creationMicros / 1000;
      if (creationMs < oldestTimestamp) oldestTimestamp = creationMs;
      if (creationMs > newestTimestamp) newestTimestamp = creationMs;
    }

    // File type aggregation
    const ext = getFileExtension(name);
    const category = categorizeExtension(ext);

    const existing = fileTypeMap.get(category) || { count: 0, totalSize: 0 };
    fileTypeMap.set(category, {
      count: existing.count + 1,
      totalSize: existing.totalSize + sizeBytes,
    });

    // Owner aggregation
    if (owner) {
      const ownerData = ownerMap.get(owner) || {
        blobCount: 0,
        totalSize: 0,
        extensions: new Set<string>()
      };
      ownerData.blobCount++;
      ownerData.totalSize += sizeBytes;
      ownerData.extensions.add(ext);
      ownerMap.set(owner, ownerData);
    }
  }

  // Calculate growth rate from sample
  let blobsPerHour = 0;
  let bytesPerHour = 0;
  if (oldestTimestamp < Infinity && newestTimestamp > oldestTimestamp) {
    const timeSpanHours = (newestTimestamp - oldestTimestamp) / (1000 * 60 * 60);
    if (timeSpanHours > 0) {
      blobsPerHour = Math.round(events.length / timeSpanHours);
      bytesPerHour = Math.round(sampleTotalSize / timeSpanHours);
    }
  }

  // Convert file type map to sorted array with colors
  const fileTypes: FileTypeStats[] = Array.from(fileTypeMap.entries())
    .map(([extension, data]) => ({
      extension,
      count: data.count,
      totalSize: data.totalSize,
      totalSizeFormatted: formatBytes(data.totalSize),
      percentage: events.length > 0 ? (data.count / events.length) * 100 : 0,
      color: categoryColors[extension] || '#7F8C8D',
    }))
    .sort((a, b) => b.count - a.count);

  // Scale file type counts to match real total if we have both
  const scaleFactor = events.length > 0 && totalBlobs > 0 ? totalBlobs / events.length : 1;
  const scaledFileTypes = scaleFactor > 1 ? fileTypes.map(ft => ({
    ...ft,
    count: Math.round(ft.count * scaleFactor),
    totalSize: Math.round(ft.totalSize * scaleFactor),
    totalSizeFormatted: formatBytes(Math.round(ft.totalSize * scaleFactor)),
  })) : fileTypes;

  // Convert owner map to sorted leaderboard
  const storageLeaders: StorageLeader[] = Array.from(ownerMap.entries())
    .map(([address, data]) => ({
      address,
      addressShort: shortenAddress(address),
      blobCount: data.blobCount,
      totalSize: data.totalSize,
      totalSizeFormatted: formatBytes(data.totalSize),
      fileTypes: Array.from(data.extensions).slice(0, 5),
    }))
    .sort((a, b) => b.totalSize - a.totalSize)
    .slice(0, 10); // Top 10 storage users

  // Use provided totals if available, otherwise use sample totals
  const finalTotalBlobs = totalBlobs > 0 ? totalBlobs : events.length;
  const finalTotalStorage = totalStorage > 0 ? totalStorage : sampleTotalSize;
  const avgBlobSize = finalTotalBlobs > 0 ? finalTotalStorage / finalTotalBlobs : 0;

  return {
    fileTypes: scaledFileTypes,
    storageLeaders,
    totalBlobs: finalTotalBlobs,
    totalSize: finalTotalStorage,
    totalSizeFormatted: formatBytes(finalTotalStorage),
    avgBlobSize,
    avgBlobSizeFormatted: formatBytes(avgBlobSize),
    uniqueOwners: ownerMap.size,
    blobsPerHour,
    bytesPerHour,
    bytesPerHourFormatted: formatBytes(bytesPerHour),
    timestamp: Date.now(),
  };
}

/**
 * Legacy function - now just a wrapper that fetches events and computes analytics
 * Prefer using computeAnalyticsFromEvents with pre-fetched data to avoid rate limits
 */
export async function getAnalyticsData(
  aptosClient: ShelbyAptosClient
): Promise<AnalyticsData> {
  logger.info('Fetching comprehensive analytics data');

  try {
    // Fetch events first - this is the primary data source
    // Use a smaller sample to avoid rate limits
    const events = await aptosClient.fetchBlobEvents(200);

    if (events.length === 0) {
      logger.warn('No events fetched for analytics - likely rate limited');
      return {
        fileTypes: [],
        storageLeaders: [],
        totalBlobs: 0,
        totalSize: 0,
        totalSizeFormatted: '0 B',
        avgBlobSize: 0,
        avgBlobSizeFormatted: '0 B',
        uniqueOwners: 0,
        blobsPerHour: 0,
        bytesPerHour: 0,
        bytesPerHourFormatted: '0 B',
        timestamp: Date.now(),
      };
    }

    // Try to get totals, but don't fail if rate limited
    let totalBlobs = 0;
    let totalStorage = 0;

    try {
      [totalBlobs, totalStorage] = await Promise.all([
        aptosClient.getTotalBlobCount(),
        aptosClient.getTotalStorage(),
      ]);
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch totals for analytics - using sample data');
      // Will use event sample for totals
    }

    const analytics = computeAnalyticsFromEvents(events, totalBlobs, totalStorage);

    logger.info({
      totalBlobs: analytics.totalBlobs,
      totalStorage: analytics.totalSize,
      sampleSize: events.length,
      uniqueOwners: analytics.uniqueOwners,
      blobsPerHour: analytics.blobsPerHour,
    }, 'Analytics data computed');

    return analytics;
  } catch (error) {
    logger.error({ error }, 'Failed to fetch analytics data');
    throw error;
  }
}
