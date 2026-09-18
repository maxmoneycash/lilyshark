// Merges a research proposal into the catalog after checking it the way the build would.
// Usage: node scripts/merge-proposal.mjs data/catalog-expansion-proposal-x-2026-09-17.json [--dry-run]
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateDeviceDetails } from '../src/device-details.mjs';
import { categories, statuses, tasks, formats, capabilities } from '../src/catalog.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [file, ...flags] = process.argv.slice(2);
if (!file) { console.error('Give a proposal file.'); process.exit(1); }
const dry = flags.includes('--dry-run');
const read = async f => JSON.parse(await fs.readFile(path.join(root, f), 'utf8'));
const write = async (f, v) => fs.writeFile(path.join(root, f), JSON.stringify(v, null, 2) + '\n');

const proposal = JSON.parse(await fs.readFile(path.resolve(file), 'utf8'));
const catalog = await read('data/catalog.json'), details = await read('data/device-details.json'), images = await read('data/images.json');
const expansionFile = 'data/expansion-2026-09-16.json', expansion = await read(expansionFile);
const existing = new Set(catalog.map(d => d.slug)), names = new Set(catalog.map(d => d.name.toLowerCase()));
const https = v => { try { const u = new URL(v); return u.protocol === 'https:'; } catch { return false; } };
const date = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const problems = [], accepted = [];

for (const d of proposal.catalog || []) {
  const fail = r => problems.push(`${d.slug || '?'}: ${r}`);
  if (!/^[a-z0-9-]+$/.test(d.slug || '')) { fail('bad slug'); continue; }
  if (existing.has(d.slug)) { fail('already in catalog'); continue; }
  if (names.has((d.name || '').toLowerCase())) fail('name already in catalog');
  if (!d.name?.trim() || !d.maker?.trim() || !d.description?.trim()) fail('missing name/maker/description');
  if (!Object.hasOwn(categories, d.category)) fail(`bad category ${d.category}`);
  if (!Object.hasOwn(statuses, d.status) || d.status === 'concept') fail(`bad status ${d.status}`);
  if (!Array.isArray(d.tags) || d.tags.length < 2 || d.tags.length > 6) fail('need 2–6 tags');
  for (const k of ['processor', 'display', 'radio', 'power']) if (!d.specs?.[k]?.trim()) fail(`missing spec ${k}`);
  if (d.price !== null && typeof d.price !== 'string') fail('price must be string or null');
  if (!https(d.source)) fail('source must be https');
  if (d.buy && !https(d.buy)) fail('buy must be https');
  if (!d.sourceLabel?.trim()) fail('missing sourceLabel');
  if (!date(d.checked) || !date(d.reviewed) || !date(d.added) || d.verified !== true) fail('missing dates or verified');
  if (!Array.isArray(d.verificationNotes) || d.verificationNotes.length < 2) fail('need ≥2 verificationNotes');
  for (const s of d.extraSources || []) if (!s.label?.trim() || !https(s.url)) fail('bad extraSource');
  const u = d.usage || {};
  if (!Array.isArray(u.tasks) || !u.tasks.length || !u.tasks.every(t => Object.hasOwn(tasks, t))) fail('bad usage.tasks');
  if (!Object.hasOwn(formats, u.format) || u.format === 'concept' || u.format === 'unknown') fail(`bad usage.format ${u.format}`);
  for (const k of ['goodFor', 'needs', 'tradeoff']) if (!u[k]?.trim()) fail(`missing usage.${k}`);
  if (!Array.isArray(u.capabilities) || !u.capabilities.every(c => Object.hasOwn(capabilities, c))) fail('bad usage.capabilities');
  const p = proposal.details?.[d.slug], im = proposal.images?.[d.slug];
  if (!p) fail('missing details'); if (!im) fail('missing image');
  if (im) {
    for (const k of ['source', 'sourcePage']) if (!https(im[k])) fail(`image ${k} must be https`);
    if (!im.caption?.trim() || !im.credit?.trim() || !im.usage?.trim() || !date(im.retrieved)) fail('image needs caption, credit, usage, retrieved');
    if (im.path !== `/assets/${d.slug}.jpg`) fail(`image path must be /assets/${d.slug}.jpg`);
    try {
      const bytes = await fs.readFile(path.join(root, 'public', im.path));
      const sha = createHash('sha256').update(bytes).digest('hex');
      if (sha !== im.sha256) fail(`image sha256 mismatch (file ${sha.slice(0, 8)}…)`);
      if (bytes.length > 600000) fail('image over 600 KB; resize');
    } catch { fail('image file missing'); }
  }
  if (!problems.some(x => x.startsWith(`${d.slug}:`))) accepted.push(d);
}

// Run the build's detail validator on the accepted subset.
const trialDetails = Object.fromEntries(accepted.map(d => [d.slug, proposal.details[d.slug]]));
for (const d of accepted) {
  try { validateDeviceDetails([d], { [d.slug]: trialDetails[d.slug] }); }
  catch (e) { problems.push(`${d.slug}: ${e.message}`); accepted.splice(accepted.indexOf(d), 1); }
}

console.log(`${accepted.length} accepted, ${problems.length} problems${dry ? ' (dry run)' : ''}`);
for (const p of problems) console.log(`  ! ${p}`);
if (dry || !accepted.length) process.exit(problems.length && !accepted.length ? 1 : 0);

for (const d of accepted) {
  catalog.push(d); details[d.slug] = proposal.details[d.slug]; images[d.slug] = proposal.images[d.slug]; expansion.push(d.slug);
}
await write('data/catalog.json', catalog); await write('data/device-details.json', details); await write('data/images.json', images); await write(expansionFile, expansion);
console.log(`Merged: ${accepted.map(d => d.slug).join(', ')}`);
