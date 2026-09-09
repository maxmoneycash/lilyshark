import type { VercelRequest, VercelResponse } from '@vercel/node';
import { forwardCoverageRequest } from '../server/meshmapperCoverage.js';
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).end(); }
  const result = await forwardCoverageRequest(req.body);
  for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
  return res.status(result.status).send(result.body);
}
