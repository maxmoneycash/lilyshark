import { parseCoverage } from '../src/lib/meshmapper.js';

const BACKEND_COVERAGE_URL = 'https://64-23-133-21.sslip.io/api/community-coverage';

/** The durable backend owns the shared credential and refresh quota. Serverless
 * instances only relay its public snapshot, so cold starts cannot spend quota. */
export async function sharedCoverage(fetcher: typeof fetch = fetch) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' };
  try {
    const response = await fetcher(BACKEND_COVERAGE_URL, {
      headers: { Accept: 'application/json' }, redirect: 'error',
      signal: AbortSignal.timeout(28000), cache: 'no-store',
    });
    const retryAfter = response.headers.get('Retry-After');
    if (retryAfter) headers['Retry-After'] = retryAfter;
    if (response.status !== 200) {
      return { status: [401, 403, 429, 503].includes(response.status) ? response.status : 502,
        headers, body: JSON.stringify({ error: response.status === 503 ? 'coverage_not_configured' : 'coverage_unavailable' }) };
    }
    const body = await response.text();
    parseCoverage(JSON.parse(body));
    headers['Cache-Control'] = 'public, max-age=900, s-maxage=900';
    const etag = response.headers.get('ETag');
    if (etag) headers.ETag = etag;
    return { status: 200, headers, body };
  } catch {
    return { status: 502, headers, body: JSON.stringify({ error: 'coverage_unavailable' }) };
  }
}
