// How much of the catalog can earn money, and where the gaps are.
// Run: node scripts/coverage.mjs [--gaps]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAffiliateActive } from '../src/affiliates.mjs';
import { activeListing } from '../src/listings.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = async f => JSON.parse(await fs.readFile(path.join(root, f), 'utf8'));
const [catalog, programs, listings] = await Promise.all([read('data/catalog.json'), read('data/affiliates.json'), read('data/listings.json')]);
const host = value => { try { return new URL(value).hostname; } catch { return ''; } };

const rows = catalog.filter(d => !d.owned).map(d => {
  const program = programs.find(p => p.hosts.includes(host(d.buy || d.source || '')));
  return { device: d, program, listing: activeListing(listings, d.slug), live: program ? isAffiliateActive(program) : false };
});

const byProgram = new Map();
for (const r of rows) if (r.program) byProgram.set(r.program.merchant, (byProgram.get(r.program.merchant) || 0) + 1);
const covered = rows.filter(r => r.program).length, live = rows.filter(r => r.live).length, selling = rows.filter(r => r.listing).length;

console.log(`${rows.length} devices (excluding our own concept)\n`);
console.log(`Affiliate coverage : ${covered} devices sit on a merchant with a program (${Math.round(covered / rows.length * 100)}%)`);
console.log(`Actually earning   : ${live} — the rest wait on an affiliate ID being pasted into data/affiliates.json`);
console.log(`Buy button         : ${selling} devices have an active listing\n`);
console.log('Devices per program:');
for (const [merchant, n] of [...byProgram].sort((a, b) => b[1] - a[1])) {
  const p = programs.find(x => x.merchant === merchant);
  console.log(`  ${String(n).padStart(3)}  ${merchant}${isAffiliateActive(p) ? '' : '  (inactive — no ID yet)'}`);
}

if (process.argv.includes('--gaps')) {
  const gaps = new Map();
  for (const r of rows.filter(r => !r.program && !r.listing)) {
    const h = host(r.device.buy || r.device.source || '') || '(no source)';
    if (!gaps.has(h)) gaps.set(h, []);
    gaps.get(h).push(`${r.device.slug} · ${r.device.status}${r.device.price ? ` · ${r.device.price}` : ''}`);
  }
  console.log(`\nNo way to earn on ${[...gaps.values()].flat().length} devices, by merchant:`);
  for (const [h, list] of [...gaps].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ${h} (${list.length})`);
    for (const line of list) console.log(`    ${line}`);
  }
}
