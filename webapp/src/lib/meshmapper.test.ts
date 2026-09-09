import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COVERAGE_REFRESH_MS, COVERAGE_TYPES, filterCoverage, keyFingerprint, parseCoverage, refreshCoverage, repeaterID, retryTime, validCoordinates } from './meshmapper';
import { forwardCoverageRequest } from '../../server/meshmapperCoverage';
const fixture = JSON.parse(readFileSync(new URL('../../../ios/Packages/MeshCoreKit/Tests/MeshCoreKitTests/Fixtures/meshmapper-v2.json', import.meta.url), 'utf8'));
const report = parseCoverage(fixture);
const fetcher = (fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => fn as typeof fetch;
test('coverage parser accepts nulls and future types; coordinate filters exclude invalid cells', () => {
  assert.equal(filterCoverage(report, { types: COVERAGE_TYPES }).length, 3);
  assert.equal(report.grid_squares[1].snr, null);
  assert.deepEqual(filterCoverage(report, { types: COVERAGE_TYPES, minimumSNR: 0, since: 1710547150 }).map(c => c.grid_id), ['test-1']);
  assert.deepEqual(filterCoverage(report, { types: ['RX'] }).map(c => c.grid_id), ['test-2']);
  assert.equal(filterCoverage(report, { types: [] }).length, 0);
  assert.throws(() => parseCoverage({ success: false }));
  assert.throws(() => parseCoverage({ ...fixture, grid_squares: [{ ...fixture.grid_squares[0], snr: 'bad' }] }));
  assert.throws(() => parseCoverage({ ...fixture, data_age_seconds: 'bad' }));
  assert.throws(() => parseCoverage({ ...fixture, point_count: 1.5 }));
  assert.throws(() => parseCoverage({ ...fixture, grid_squares: [{ ...fixture.grid_squares[0], status_mask: 1.5 }] }));
  assert.throws(() => parseCoverage({ ...fixture, repeaters: [{ ...fixture.repeaters[0], advert_bytes: 'bad' }] }));
});
test('explicit zero positions and colliding repeater prefixes remain distinct', () => {
  assert.ok(validCoordinates(0, 0)); assert.equal(validCoordinates(null, null), false);
  assert.notEqual(repeaterID(report.repeaters![0]), repeaterID(report.repeaters![1]));
});
test('overlapping snapshots do not duplicate map identities or mutate the payload', () => {
  const payload = { ...fixture, grid_squares: [...fixture.grid_squares, fixture.grid_squares[0]], repeaters: [...fixture.repeaters, fixture.repeaters[0]] };
  const parsed = parseCoverage(payload);
  assert.equal(parsed.grid_squares.length, fixture.grid_squares.length);
  assert.equal(parsed.repeaters?.length, fixture.repeaters.length);
  assert.equal(payload.grid_squares.length, fixture.grid_squares.length + 1);
});
test('cached snapshots prevent polling and 304 preserves the data', async () => {
  const now = 1000000;
  const cache = { report, fingerprint: await keyFingerprint('test-key'), checkedAt: now, nextAllowed: now + COVERAGE_REFRESH_MS, etag: '"v2"' };
  const result = await refreshCoverage('test-key', cache, fetcher(async () => { throw new Error('must not fetch'); }), now);
  assert.equal(result.cache, cache);
  const conditional = await refreshCoverage('test-key', cache, fetcher(async (url, init) => {
    assert.equal(url, '/api/meshmapper-coverage');
    assert.equal(JSON.parse(String(init?.body)).etag, '"v2"');
    return new Response(null, { status: 304 });
  }), cache.nextAllowed);
  assert.equal(conditional.cache.report, report);
});
test('a different key never receives another key’s conditional request or snapshot', async () => {
  const previous = { report, fingerprint: await keyFingerprint('old'), checkedAt: 0, nextAllowed: 99999999, etag: 'private' };
  const result = await refreshCoverage('new', previous, fetcher(async (_, init) => {
    assert.equal(JSON.parse(String(init?.body)).etag, undefined);
    return new Response('{}', { status: 403 });
  }), 1);
  assert.equal(result.cache.report, undefined);
  assert.match(result.error!, /rejected/);
});
test('429 respects server reset and retains offline data', async () => {
  const previous = { report, fingerprint: await keyFingerprint('test'), checkedAt: 0, nextAllowed: 0 };
  const result = await refreshCoverage('test', previous, fetcher(async () => new Response('{"resets_in_hours":12.5}', { status: 429 })), 1000);
  assert.equal(result.cache.nextAllowed, 45001000);
  assert.equal(result.cache.report, report);
  assert.equal(retryTime({}, '3600', 1000), 3601000);
  assert.equal(retryTime({}, 'bad', 1000), 901000);
});
test('proxy fixes destination, forwards ETag, and never caches authenticated responses', async () => {
  const result = await forwardCoverageRequest({ key: 'secret&key', etag: '"v2"', url: 'https://evil.invalid' }, fetcher(async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://meshmapper.net');
    assert.equal(url.searchParams.get('key'), 'secret&key');
    assert.equal(url.searchParams.get('include'), 'repeaters');
    assert.equal((init?.headers as Record<string, string>)['If-None-Match'], '"v2"');
    assert.equal(init?.redirect, 'error');
    return new Response(null, { status: 304, headers: { ETag: '"v2"' } });
  }));
  assert.equal(result.status, 304); assert.equal(result.body, '');
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
});
test('proxy rejects missing keys and sanitizes upstream errors', async () => {
  assert.equal((await forwardCoverageRequest({})).status, 400);
  const result = await forwardCoverageRequest({ key: 'test' }, fetcher(async () => new Response('{"message":"secret-key","resets_in_hours":3}', { status: 429 })));
  assert.equal(result.body.includes('secret-key'), false);
  assert.equal(JSON.parse(result.body).resets_in_hours, 3);
});
