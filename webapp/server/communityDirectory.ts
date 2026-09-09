import { parseDirectory } from '../src/lib/communityDirectory.js';
let cached: { nodes: ReturnType<typeof parseDirectory>; at: number } | undefined;
let pending: Promise<typeof cached> | undefined;
export async function communityDirectory() {
  if (cached && Date.now() - cached.at < 300000) return cached;
  if (pending) return pending;
  pending = (async () => {
    const response = await fetch('https://map.meshcore.dev/api/v1/nodes?binary=0&short=0', { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Directory unavailable.');
    cached = { nodes: parseDirectory(await response.json()), at: Date.now() };
    return cached;
  })();
  try { return await pending; } finally { pending = undefined; }
}
