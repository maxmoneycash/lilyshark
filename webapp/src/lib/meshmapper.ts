/** Documented regional / multi-region Coverage API. No private map endpoints. */
export const COVERAGE_TYPES = ['BIDIR', 'DISC', 'TX', 'RX', 'DEAD', 'DROP'] as const;
export type CoverageType = typeof COVERAGE_TYPES[number];
export const COVERAGE_LABELS: Record<CoverageType, string> = {
  BIDIR: 'Two-way', DISC: 'Discovery', TX: 'Transmit', RX: 'Receive', DEAD: 'Dead end', DROP: 'Dropped',
};
export interface MapperCell {
  grid_id: string;
  bounds: { south: number; west: number; north: number; east: number };
  coverage_type: string;
  fill_color: string;
  border_color: string;
  snr: number | null;
  timestamp: number | null;
  count?: number;
  snr_min?: number | null;
  snr_max?: number | null;
  first_seen?: number | null;
  status_mask?: number;
  noise?: number | null;
  effective?: number | null;
}
export interface MapperRepeater {
  hex: string; name: string | null; lat: number | null; lon: number | null;
  enabled: number; last_heard: number | null; advert_bytes?: number | null;
}
export interface MapperReport {
  success: true; region: string; region_name: string; generated_at: number;
  data_age_seconds: number | null; point_count?: number;
  grid_squares: MapperCell[]; repeaters?: MapperRepeater[];
}
export interface MapperFilter { types: readonly string[]; minimumSNR?: number; since?: number }
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function validCoordinates(lat: unknown, lon: unknown): boolean {
  return finite(lat) && finite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}
export function validBounds(b: MapperCell['bounds']): boolean {
  return validCoordinates(b.south, b.west) && validCoordinates(b.north, b.east) && b.south < b.north && b.west < b.east;
}
export function repeaterID(node: MapperRepeater): string { return `${node.hex.toUpperCase()}:${node.lat ?? '?'}:${node.lon ?? '?'}`; }
export function parseCoverage(value: unknown): MapperReport {
  if (!object(value) || value.success !== true || typeof value.region !== 'string' || typeof value.region_name !== 'string' || !finite(value.generated_at) || !Array.isArray(value.grid_squares)) {
    throw new Error('A regional coverage snapshot is required.');
  }
  if ((value.data_age_seconds != null && !finite(value.data_age_seconds)) ||
      (value.point_count != null && !Number.isSafeInteger(value.point_count))) {
    throw new Error('The coverage snapshot contains invalid summary measurements.');
  }
  for (const cell of value.grid_squares) {
    if (!object(cell) || typeof cell.grid_id !== 'string' || !object(cell.bounds) ||
        !['south', 'west', 'north', 'east'].every(k => finite(cell.bounds && (cell.bounds as Record<string, unknown>)[k])) ||
        typeof cell.coverage_type !== 'string' || typeof cell.fill_color !== 'string' || typeof cell.border_color !== 'string' ||
        (cell.snr != null && !finite(cell.snr)) || (cell.timestamp != null && !finite(cell.timestamp))) {
      throw new Error('The coverage snapshot contains an invalid cell.');
    }
    for (const field of ['count', 'snr_min', 'snr_max', 'first_seen', 'status_mask', 'noise', 'effective']) {
      if (cell[field] != null && !finite(cell[field])) throw new Error('Invalid coverage measurement.');
    }
    for (const field of ['count', 'status_mask']) {
      if (cell[field] != null && !Number.isSafeInteger(cell[field])) throw new Error('Invalid coverage count.');
    }
  }
  if (value.repeaters != null && (!Array.isArray(value.repeaters) || value.repeaters.some(n =>
    !object(n) || typeof n.hex !== 'string' || (n.name != null && typeof n.name !== 'string') ||
    !Number.isSafeInteger(n.enabled) || (n.lat != null && !finite(n.lat)) || (n.lon != null && !finite(n.lon)) || (n.last_heard != null && !finite(n.last_heard)) ||
    (n.advert_bytes != null && !Number.isSafeInteger(n.advert_bytes))
  ))) throw new Error('The coverage snapshot contains an invalid repeater.');
  const report = value as unknown as MapperReport;
  // Stable first-record wins for overlapping regional feeds. Prefix collisions
  // at different coordinates stay distinct, while duplicate IDs cannot create
  // duplicate React keys or count the same observation twice.
  return { ...report,
    grid_squares: uniqueRecords(report.grid_squares, cell => cell.grid_id),
    repeaters: report.repeaters ? uniqueRecords(report.repeaters, repeaterID) : undefined,
  };
}
function uniqueRecords<T>(records: T[], id: (record: T) => string): T[] {
  const seen = new Set<string>();
  return records.filter(record => {
    const key = id(record);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
export function filterCoverage(report: MapperReport, filter: MapperFilter): MapperCell[] {
  return report.grid_squares.filter(cell => validBounds(cell.bounds) &&
    (filter.types.includes(cell.coverage_type) || (!COVERAGE_TYPES.includes(cell.coverage_type as CoverageType) && COVERAGE_TYPES.every(t => filter.types.includes(t)))) &&
    (filter.minimumSNR === undefined || (cell.snr != null && cell.snr >= filter.minimumSNR)) &&
    (filter.since === undefined || (cell.timestamp != null && cell.timestamp >= filter.since)));
}
export const COVERAGE_REFRESH_MS = 15 * 60 * 1000;
export interface CoverageCache { report?: MapperReport; fingerprint: string; checkedAt: number; nextAllowed: number; etag?: string }
export function retryTime(body: unknown, retryAfter: string | null, now: number): number {
  const hours = object(body) && finite(body.resets_in_hours) ? body.resets_in_hours : 0;
  const header = retryAfter ? (/^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now) : 0;
  return now + Math.max(COVERAGE_REFRESH_MS, hours * 3600000, Number.isFinite(header) ? header : 0);
}
export async function keyFingerprint(key: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key.trim()));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export async function refreshCoverage(key: string, previous?: CoverageCache, fetcher: typeof fetch = fetch, now = Date.now()): Promise<{ cache: CoverageCache; error?: string }> {
  const fingerprint = await keyFingerprint(key);
  const cache = previous?.fingerprint === fingerprint ? previous : undefined;
  if (cache && now < cache.nextAllowed) return { cache };
  const next: CoverageCache = { ...cache, fingerprint, checkedAt: now, nextAllowed: now + COVERAGE_REFRESH_MS };
  try {
    const response = await fetcher('/api/meshmapper-coverage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ key: key.trim(), etag: cache?.report ? cache.etag : undefined }), signal: AbortSignal.timeout(35000),
    });
    if (response.status === 304 && cache?.report) return { cache: next };
    if (response.status === 401 || response.status === 403) return { cache: next, error: 'The coverage service rejected this key. Check its region and access with the issuer.' };
    if (response.status === 429) {
      next.nextAllowed = retryTime(await response.json().catch(() => ({})), response.headers.get('Retry-After'), now);
      return { cache: next, error: 'The coverage service’s request limit was reached. Saved coverage remains available.' };
    }
    if (!response.ok) throw new Error('refresh');
    next.report = parseCoverage(await response.json());
    next.etag = response.headers.get('ETag') ?? undefined;
    return { cache: next };
  } catch {
    return { cache: next, error: 'Coverage could not be refreshed. Check your connection. Any saved snapshot is still available.' };
  }
}

export const SHARED_COVERAGE_FINGERPRINT = 'lilyshark-shared-v1';
/** App-owned feed for ordinary users. An optional personal feed takes precedence. */
export async function refreshCoverageFromService(previous?: CoverageCache, fetcher: typeof fetch = fetch, now = Date.now()): Promise<{ cache: CoverageCache; error?: string }> {
  if (previous && previous.fingerprint !== SHARED_COVERAGE_FINGERPRINT) return { cache: previous };
  if (previous && now < previous.nextAllowed) return { cache: previous };
  const cache: CoverageCache = { ...previous, fingerprint: SHARED_COVERAGE_FINGERPRINT, checkedAt: now, nextAllowed: now + COVERAGE_REFRESH_MS };
  try {
    const response = await fetcher('/api/community-coverage', { signal: AbortSignal.timeout(30000) });
    if (response.status === 503 || response.status === 404) return { cache, error: 'Community coverage is not connected yet. Repeater positions and My mesh remain available.' };
    if (response.status === 429) {
      cache.nextAllowed = retryTime(await response.json().catch(() => ({})), response.headers.get('Retry-After'), now);
      return { cache, error: 'Coverage refresh is paused by the data service. Any saved snapshot remains available.' };
    }
    if (!response.ok) throw new Error('coverage');
    cache.report = parseCoverage(await response.json());
    return { cache };
  } catch { return { cache, error: 'Community coverage could not be refreshed. Any saved snapshot remains available.' }; }
}
