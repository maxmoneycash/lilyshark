import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createDurableCoverageService } from './coverage-service.js';

const HOUR = 3_600_000;
const fixture = JSON.stringify({ success: true, region: 'test', region_name: 'Synthetic test region',
  generated_at: 1234, data_age_seconds: null, point_count: 1,
  grid_squares: [{ grid_id: 'test', bounds: { south: 0, west: 0, north: 1, east: 1 },
    coverage_type: 'BIDIR', fill_color: '#ffffff', border_color: '#000000', snr: null, timestamp: null }],
  repeaters: [{ hex: 'AA', name: null, lat: 0, lon: 0, enabled: 1, last_heard: null }] });
const fetcher = (fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => fn as typeof fetch;

function database(t: { after: (fn: () => void) => void }) {
  const directory = mkdtempSync(join(tmpdir(), 'lilyshark-coverage-'));
  const path = join(directory, 'cache.db');
  const connections: Database.Database[] = [];
  const open = () => { const db = new Database(path); db.pragma('journal_mode = WAL'); connections.push(db); return db; };
  t.after(() => { for (const db of connections) if (db.open) db.close(); rmSync(directory, { recursive: true }); });
  return { open };
}

test('missing or malformed key makes no provider request and stores no key', async t => {
  const db = database(t).open();
  let key: string | undefined, requests = 0;
  const service = createDurableCoverageService(db, { key: () => key, fetcher: fetcher(async () => { requests++; throw new Error(); }) });
  for (key of [undefined, '', 'x\r\ny', 'x'.repeat(1025)]) assert.equal((await service()).status, 503);
  assert.equal(requests, 0);
  assert.equal((db.prepare('SELECT COUNT(*) as n FROM community_coverage_cache').get() as { n: number }).n, 0);
});

test('a restart preserves the hourly reservation, exact snapshot, and conditional ETag', async t => {
  const storage = database(t);
  let now = 1000, requests = 0;
  const request = fetcher(async (input, init) => {
    requests++;
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, 'https://meshmapper.net/coverage.php');
    assert.equal(url.searchParams.get('key'), 'private-key');
    assert.equal(url.searchParams.get('include'), 'repeaters');
    assert.equal(init?.redirect, 'error');
    if (requests === 1) return new Response(fixture, { headers: { ETag: '"one"' } });
    assert.equal(new Headers(init?.headers).get('If-None-Match'), '"one"');
    return new Response(null, { status: 304 });
  });
  const db = storage.open();
  const first = createDurableCoverageService(db, { key: () => 'private-key', fetcher: request, now: () => now });
  assert.equal((await first()).body, fixture);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM community_coverage_cache').all()).includes('private-key'), false);
  db.close();
  const restarted = createDurableCoverageService(storage.open(), { key: () => 'private-key', fetcher: request, now: () => now });
  assert.equal((await restarted()).body, fixture); assert.equal(requests, 1);
  now += HOUR;
  const updated = await restarted();
  assert.equal(updated.body, fixture); assert.equal(updated.headers.ETag, '"one"'); assert.equal(requests, 2);
});

test('two independent worker connections cannot spend the same hourly reservation', async t => {
  const storage = database(t);
  let release!: (response: Response) => void;
  let requests = 0;
  const request = fetcher(async () => { requests++; return new Promise(resolve => { release = resolve; }); });
  const a = createDurableCoverageService(storage.open(), { key: () => 'shared', fetcher: request, now: () => 1000 });
  const b = createDurableCoverageService(storage.open(), { key: () => 'shared', fetcher: request, now: () => 1000 });
  const pending = a();
  const sameWorker = a();
  assert.equal((await b()).status, 503); assert.equal(requests, 1);
  release(new Response(fixture));
  assert.equal((await pending).body, fixture); assert.equal((await sameWorker).body, fixture);
  assert.equal((await b()).body, fixture); assert.equal(requests, 1);
});

test('worker interruption cannot reset an already committed attempt reservation', async t => {
  const storage = database(t);
  const db = storage.open();
  let now = 1000, requests = 0;
  const service = createDurableCoverageService(db, { key: () => 'key', now: () => now,
    fetcher: fetcher(async () => { requests++; throw new Error('network failed'); }) });
  assert.equal((await service()).status, 502);
  // Simulate a process dying after reservation but before storing its response.
  db.prepare("UPDATE community_coverage_cache SET status = 503, refresh_token = 'abandoned'").run();
  db.close();
  const restarted = createDurableCoverageService(storage.open(), { key: () => 'key', now: () => now,
    fetcher: fetcher(async () => { requests++; return new Response(fixture); }) });
  assert.equal((await restarted()).status, 503); assert.equal(requests, 1);
  now += HOUR;
  assert.equal((await restarted()).body, fixture); assert.equal(requests, 2);
});

test('429 retains the last snapshot and durable cooldown across restart', async t => {
  const storage = database(t);
  let now = 1000, requests = 0;
  const request = fetcher(async () => ++requests === 1 ? new Response(fixture) :
    new Response('{"resets_in_hours":12.5}', { status: 429, headers: { 'Retry-After': '54000' } }));
  const service = createDurableCoverageService(storage.open(), { key: () => 'key', now: () => now, fetcher: request });
  await service(); now += HOUR;
  assert.equal((await service()).body, fixture);
  const restarted = createDurableCoverageService(storage.open(), { key: () => 'key', now: () => now, fetcher: request });
  now += 14 * HOUR;
  assert.equal((await restarted()).body, fixture); assert.equal(requests, 2);
  now += HOUR;
  await restarted(); assert.equal(requests, 3);
});

test('429 without a snapshot returns a sanitized retry delay and honors an HTTP date', async t => {
  const time = Date.UTC(2026, 8, 8);
  const service = createDurableCoverageService(database(t).open(), { key: () => 'secret', now: () => time,
    fetcher: fetcher(async () => new Response('{"error":"secret echoed upstream"}', {
      status: 429, headers: { 'Retry-After': new Date(time + 2 * HOUR).toUTCString() },
    })) });
  const result = await service();
  assert.equal(result.status, 429); assert.equal(result.headers['Retry-After'], '7200');
  assert.equal(result.body, '{"error":"rate_limited"}');
});

test('bad schemas and network failures preserve the snapshot and wait an hour', async t => {
  const db = database(t).open();
  let now = 0, requests = 0;
  const bodies = [fixture, '{"success":true}', fixture.replace('"point_count":1', '"point_count":"bad"')];
  const service = createDurableCoverageService(db, { key: () => 'key', now: () => now,
    fetcher: fetcher(async () => { requests++; if (requests > bodies.length) throw new Error('key'); return new Response(bodies[requests - 1]); }) });
  for (let i = 0; i < 4; i++) {
    assert.equal((await service()).body, fixture);
    assert.equal((await service()).body, fixture);
    assert.equal(requests, i + 1);
    now += HOUR;
  }
});

test('rotating a credential isolates snapshots and a revoked grant clears its data', async t => {
  const db = database(t).open();
  let now = 0, key = 'old';
  const service = createDurableCoverageService(db, { key: () => key, now: () => now,
    fetcher: fetcher(async () => key === 'old' && now === 0 ? new Response(fixture) : new Response('credential', { status: 403 })) });
  assert.equal((await service()).body, fixture);
  key = 'new'; assert.equal((await service()).status, 403);
  key = 'old'; now += HOUR;
  const revoked = await service();
  assert.equal(revoked.status, 403); assert.equal(revoked.body.includes('credential'), false);
  assert.equal((db.prepare('SELECT COUNT(*) as n FROM community_coverage_cache WHERE body IS NOT NULL').get() as { n: number }).n, 0);
});

test('a database write failure prevents any provider request', async t => {
  const db = database(t).open();
  let requests = 0;
  const service = createDurableCoverageService(db, { key: () => 'key', fetcher: fetcher(async () => { requests++; return new Response(fixture); }) });
  db.pragma('query_only = ON');
  await assert.rejects(service()); assert.equal(requests, 0);
});
