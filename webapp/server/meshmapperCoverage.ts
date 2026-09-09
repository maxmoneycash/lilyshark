/** Fixed-destination proxy: keep keys out of browser URLs, access logs and CDN caches. */
export async function forwardCoverageRequest(body: unknown, fetcher: typeof fetch = fetch) {
  const headers: Record<string, string> = { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json' };
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  if (typeof input.key !== 'string' || !input.key.trim() || input.key.length > 1024 || /[\r\n]/.test(input.key)) {
    return { status: 400, headers, body: JSON.stringify({ error: 'A coverage API key is required.' }) };
  }
  const url = new URL('https://meshmapper.net/coverage.php');
  url.searchParams.set('key', input.key.trim());
  url.searchParams.set('include', 'repeaters');
  const upstreamHeaders: Record<string, string> = { Accept: 'application/json' };
  if (typeof input.etag === 'string' && input.etag.length < 512 && !/[\r\n]/.test(input.etag)) upstreamHeaders['If-None-Match'] = input.etag;
  try {
    const response = await fetcher(url, { headers: upstreamHeaders, signal: AbortSignal.timeout(30000), redirect: 'error', cache: 'no-store' });
    for (const name of ['ETag', 'Retry-After']) {
      const value = response.headers.get(name);
      if (value) headers[name] = value;
    }
    if (response.status === 304) return { status: 304, headers, body: '' };
    if (!response.ok) {
      // Do not forward upstream diagnostics that might echo a request URL or key.
      const payload = await response.json().catch(() => ({})) as { resets_in_hours?: unknown };
      return { status: [400, 401, 403, 429].includes(response.status) ? response.status : 502, headers,
        body: JSON.stringify({ error: response.status === 429 ? 'rate_limited' : 'coverage_unavailable',
          ...(typeof payload.resets_in_hours === 'number' && Number.isFinite(payload.resets_in_hours) ? { resets_in_hours: payload.resets_in_hours } : {}) }) };
    }
    return { status: 200, headers, body: await response.text() };
  } catch {
    return { status: 502, headers, body: JSON.stringify({ error: 'Coverage could not be reached.' }) };
  }
}
