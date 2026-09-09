import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sharedCoverage } from '../server/sharedCoverage.js';
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).end(); }
  const result = await sharedCoverage();
  for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
  return res.status(result.status).send(result.body);
}
