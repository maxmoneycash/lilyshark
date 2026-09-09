import type { VercelRequest, VercelResponse } from '@vercel/node';
import { communityDirectory } from '../server/communityDirectory.js';
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).end(); }
  try {
    const payload = await communityDirectory();
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
    return res.status(200).json(payload);
  } catch { return res.status(502).json({ error: 'The node directory could not be loaded.' }); }
}
