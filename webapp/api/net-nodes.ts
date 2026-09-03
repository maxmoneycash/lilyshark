import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * The mesh as the internet knows it, cut down to a neighbourhood.
 *
 * The public node database is one ~30 MB document with no server-side
 * filtering — unusable from a phone and rude to hit per client. This
 * function fetches it once, filters to the caller's radius, strips each row
 * to five fields, and lets the CDN hold the result for ten minutes, so the
 * upstream sees roughly one request per cache region per ten minutes no
 * matter how many maps are open.
 */

const UPSTREAM = 'https://meshtastic.liamcottle.net/api/v1/nodes';
const FRESH_MS = 48 * 3600 * 1000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const km = Math.min(Number(req.query.km) || 60, 200);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }

  const upstream = await fetch(UPSTREAM);
  if (!upstream.ok) {
    return res.status(502).json({ error: `upstream ${upstream.status}` });
  }
  const body = (await upstream.json()) as { nodes?: unknown[] } | unknown[];
  const rows = Array.isArray(body) ? body : (body.nodes ?? []);

  const now = Date.now();
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const out: {
    num: number;
    longName: string;
    shortName: string;
    lat: number;
    lon: number;
    updatedAt: number;
  }[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    let nlat = Number(row.latitude);
    let nlon = Number(row.longitude);
    if (!Number.isFinite(nlat) || !Number.isFinite(nlon)) continue;
    if (Math.abs(nlat) > 1000) {
      nlat /= 1e7;
      nlon /= 1e7;
    }
    const updated = Date.parse(String(row.updated_at ?? '')) || 0;
    if (now - updated > FRESH_MS) continue;
    const dx = (nlon - lon) * 111.32 * cosLat;
    const dy = (nlat - lat) * 110.54;
    if (Math.hypot(dx, dy) > km) continue;
    const num = Number(row.node_id) >>> 0;
    if (!num) continue;
    out.push({
      num,
      longName: String(row.long_name ?? ''),
      shortName: String(row.short_name ?? ''),
      lat: nlat,
      lon: nlon,
      updatedAt: updated,
    });
  }

  // Ten minutes at the CDN, and stale is fine for another hour: this layer
  // is a rumour by definition, and its freshness is labelled client-side.
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
  return res.status(200).json({ nodes: out });
}
