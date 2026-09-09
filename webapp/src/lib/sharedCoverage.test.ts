import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sharedCoverage } from '../../server/sharedCoverage';
import { parseCoverage, refreshCoverageFromService, SHARED_COVERAGE_FINGERPRINT } from './meshmapper';
const fixture = readFileSync(new URL('../../../ios/Packages/MeshCoreKit/Tests/MeshCoreKitTests/Fixtures/meshmapper-v2.json', import.meta.url), 'utf8');
const report = parseCoverage(JSON.parse(fixture));
const fetcher = (fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => fn as typeof fetch;
test('shared proxy only requests the fixed backend snapshot without a provider credential', async () => {
  const response = await sharedCoverage(fetcher(async (input, init) => {
    assert.equal(String(input), 'https://64-23-133-21.sslip.io/api/community-coverage');
    assert.equal(init?.body, undefined);
    assert.deepEqual(init?.headers, { Accept: 'application/json' });
    assert.equal(init?.redirect, 'error');
    return new Response(fixture, { headers: { ETag: '"test"' } });
  }));
  assert.equal(response.status, 200); assert.equal(response.body, fixture);
  assert.equal(response.headers.ETag, '"test"');
  assert.match(response.headers['Cache-Control'], /s-maxage=900/);
});
test('shared proxy preserves status and cooldown while sanitizing upstream errors', async () => {
  for (const status of [401, 403, 429, 503]) {
    const result = await sharedCoverage(fetcher(async () => new Response('secret upstream URL', {
      status, headers: { 'Retry-After': '43200' },
    })));
    assert.equal(result.status, status);
    assert.equal(result.headers['Retry-After'], '43200');
    assert.equal(result.headers['Cache-Control'], 'private, no-store');
    assert.equal(result.body.includes('secret'), false);
  }
});
test('shared proxy rejects an old backend route, malformed snapshots, and network failures', async () => {
  for (const response of [new Response('<html>old backend</html>', { status: 404 }), new Response('{}')]) {
    assert.equal((await sharedCoverage(fetcher(async () => response))).status, 502);
  }
  const result = await sharedCoverage(fetcher(async () => { throw new Error('private URL'); }));
  assert.equal(result.status, 502); assert.equal(result.body.includes('private URL'), false);
});
test('shared client preserves a personal-key snapshot and missing-service state', async () => {
  const personal = { report, fingerprint: 'personal', checkedAt: 0, nextAllowed: 0 };
  assert.equal((await refreshCoverageFromService(personal, fetcher(async () => { throw new Error(); }))).cache, personal);
  const result = await refreshCoverageFromService(undefined, fetcher(async () => new Response('{}', { status: 503 })), 1000);
  assert.equal(result.cache.fingerprint, SHARED_COVERAGE_FINGERPRINT);
  assert.equal(result.cache.report, undefined); assert.match(result.error!, /not connected/);
});
