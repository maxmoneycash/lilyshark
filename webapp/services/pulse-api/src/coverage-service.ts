import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

const HOUR = 3_600_000;
type Result = { status: number; headers: Record<string, string>; body: string };
interface CacheRow {
  fingerprint: string;
  body: string | null;
  etag: string | null;
  status: number;
  error: string;
  next_attempt_at: number;
  refresh_token: string | null;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const nullableNumber = (value: unknown) => value == null || finite(value);
const nullableInteger = (value: unknown) => value == null || (finite(value) && Number.isSafeInteger(value));

/** Check the public wire schema before replacing a saved snapshot. Keep source
 * timestamps and unknown future coverage types intact. Both clients validate it
 * again and filter out coordinates that cannot be drawn on a map. */
function validSnapshot(value: unknown): boolean {
  if (!object(value) || value.success !== true || typeof value.region !== 'string' ||
      typeof value.region_name !== 'string' || !finite(value.generated_at) ||
      !nullableNumber(value.data_age_seconds) || !nullableInteger(value.point_count) ||
      !Array.isArray(value.grid_squares)) return false;
  for (const cell of value.grid_squares) {
    if (!object(cell) || typeof cell.grid_id !== 'string' || !object(cell.bounds) ||
        !['south', 'west', 'north', 'east'].every(key => finite((cell.bounds as Record<string, unknown>)[key])) ||
        !['coverage_type', 'fill_color', 'border_color'].every(key => typeof cell[key] === 'string') ||
        !['snr', 'timestamp', 'snr_min', 'snr_max', 'first_seen', 'noise', 'effective'].every(key => nullableNumber(cell[key])) ||
        !['count', 'status_mask'].every(key => nullableInteger(cell[key]))) return false;
  }
  return value.repeaters == null || (Array.isArray(value.repeaters) && value.repeaters.every(node =>
    object(node) && typeof node.hex === 'string' && (node.name == null || typeof node.name === 'string') &&
    Number.isSafeInteger(node.enabled) && ['lat', 'lon', 'last_heard'].every(key => nullableNumber(node[key])) &&
    nullableInteger(node.advert_bytes)));
}

function cooldown(response: Response, payload: unknown, time: number): number {
  const hours = object(payload) && finite(payload.resets_in_hours) ? payload.resets_in_hours : 0;
  const header = response.headers.get('Retry-After');
  const delay = header ? (/^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - time) : 0;
  return time + Math.max(HOUR, hours * HOUR, Number.isFinite(delay) ? delay : 0);
}

/** All workers must use the same persistent SQLite file. The IMMEDIATE
 * transaction reserves the next hour BEFORE a request leaves this process.
 * Restarting, failed fetches and concurrent workers therefore cannot reset the
 * quota window. No transaction remains open while awaiting the network. */
export function createDurableCoverageService(db: Database.Database, options: {
  key: () => string | undefined;
  fetcher?: typeof fetch;
  now?: () => number;
}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const pending = new Map<string, Promise<Result>>();
  db.exec(`CREATE TABLE IF NOT EXISTS community_coverage_cache (
    fingerprint TEXT PRIMARY KEY, body TEXT, etag TEXT,
    status INTEGER NOT NULL DEFAULT 503, error TEXT NOT NULL DEFAULT 'coverage_refreshing',
    next_attempt_at INTEGER NOT NULL DEFAULT 0, refresh_token TEXT
  )`);
  const read = db.prepare('SELECT * FROM community_coverage_cache WHERE fingerprint = ?');
  const reserve = db.transaction((fingerprint: string, time: number) => {
    const previous = read.get(fingerprint) as CacheRow | undefined;
    if (previous && previous.next_attempt_at > time) return { previous };
    const token = randomUUID();
    db.prepare(`INSERT INTO community_coverage_cache (fingerprint, next_attempt_at, refresh_token)
      VALUES (?, ?, ?) ON CONFLICT(fingerprint) DO UPDATE SET
      next_attempt_at = excluded.next_attempt_at, refresh_token = excluded.refresh_token`)
      .run(fingerprint, time + HOUR, token);
    return { previous, token };
  });

  function result(row: CacheRow): Result {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' };
    if (row.body) {
      headers['Cache-Control'] = 'public, max-age=900, s-maxage=900';
      if (row.etag) headers.ETag = row.etag;
      return { status: 200, headers, body: row.body };
    }
    headers['Retry-After'] = String(Math.max(1, Math.ceil((row.next_attempt_at - now()) / 1000)));
    return { status: row.status, headers, body: JSON.stringify({ error: row.error }) };
  }

  async function refresh(key: string, fingerprint: string): Promise<Result> {
    const reservation = reserve.immediate(fingerprint, now());
    if (!reservation.token) return result(reservation.previous!);
    const previous = reservation.previous;
    let body = previous?.body ?? null;
    let etag = previous?.etag ?? null;
    let status = 502, error = 'coverage_unavailable';
    let nextAttempt = now() + HOUR;
    try {
      const url = new URL('https://meshmapper.net/coverage.php');
      url.searchParams.set('key', key);
      url.searchParams.set('include', 'repeaters');
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (body && etag) headers['If-None-Match'] = etag;
      const response = await fetcher(url, { headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(25000) });
      nextAttempt = now() + HOUR;
      if (response.status === 200) {
        const candidate = await response.text();
        if (!validSnapshot(JSON.parse(candidate))) throw new Error('Invalid snapshot');
        body = candidate;
        etag = response.headers.get('ETag');
        status = 200;
      } else if (response.status === 304 && body) {
        etag = response.headers.get('ETag') ?? etag;
        status = 200;
      } else if (response.status === 429) {
        status = 429;
        error = 'rate_limited';
        nextAttempt = cooldown(response, await response.json().catch(() => null), now());
      } else if (response.status === 401 || response.status === 403) {
        // A revoked grant must not keep publishing its previously cached data.
        body = null; etag = null; status = response.status;
        error = 'coverage_not_authorized';
      }
    } catch {
      // No request URL, credential or upstream diagnostics reach clients/logs.
    }
    db.prepare(`UPDATE community_coverage_cache SET body = ?, etag = ?, status = ?,
      error = ?, next_attempt_at = MAX(next_attempt_at, ?), refresh_token = NULL
      WHERE fingerprint = ? AND refresh_token = ?`)
      .run(body, etag, status, error, nextAttempt, fingerprint, reservation.token);
    return result(read.get(fingerprint) as CacheRow);
  }

  return async function coverage(): Promise<Result> {
    const key = options.key()?.trim();
    if (!key || key.length > 1024 || /[\r\n]/.test(key)) {
      return { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
        body: JSON.stringify({ error: 'coverage_not_configured' }) };
    }
    const fingerprint = createHash('sha256').update(key).digest('hex');
    const existing = pending.get(fingerprint);
    if (existing) return existing;
    const promise = refresh(key, fingerprint);
    pending.set(fingerprint, promise);
    try { return await promise; }
    finally { if (pending.get(fingerprint) === promise) pending.delete(fingerprint); }
  };
}
