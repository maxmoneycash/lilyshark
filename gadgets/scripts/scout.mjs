// Watches the public listing pages we can read without a browser and prints
// hardware we have not yet considered. Run: node scripts/scout.mjs [--json]
// Tindie blocks automated reads; check it in a browser (see docs/sourcing.md).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const ua = { 'User-Agent': 'Mozilla/5.0 (Macintosh) gadgets.sh scout' };
const decode = s => s.replace(/&#39;|&#x27;/g, '’').replace(/&#34;|&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

const sources = [
  { id: 'lectronz', label: 'Lectronz newest', url: 'https://lectronz.com/products?sort=newest',
    parse: html => [...html.matchAll(/<a href="(\/products\/[^"]+)">[\s\S]*?<div class="title">([^<]+)<\/div>/g)].map(m => ({ url: `https://lectronz.com${m[1]}`, title: decode(m[2]) })) },
  { id: 'crowdsupply', label: 'Crowd Supply browse', url: 'https://www.crowdsupply.com/browse',
    parse: html => [...html.matchAll(/class="project-tile"[^>]*href="(\/[a-z0-9-]+\/[a-z0-9-]+)"[^>]*aria-label="([^"]+)"/g)].map(m => ({ url: `https://www.crowdsupply.com${m[1]}`, title: decode(m[2]) })) },
  // hackaday.io ignores ?tag= and renders search in JavaScript, so read the newest
  // projects and keep titles that mention our subjects.
  ...[1, 2, 3].map(page => ({ id: `hackaday:newest:${page}`, label: 'Hackaday.io newest projects', url: `https://hackaday.io/projects?sort=newest&page=${page}`,
    parse: html => [...html.matchAll(/<a href="(\/project\/\d+[^"]*)" title="([^"]+)">[^<]/g)].map(m => ({ url: `https://hackaday.io${m[1]}`, title: decode(m[2]) }))
      .filter(item => /mesh|lora|flipper|sdr|radio|rf\b|sub-?ghz|rfid|nfc|wifi|wi-fi|ble|bluetooth|gps|esp32|handheld|pocket|badge|cyberdeck|pentest|scanner/i.test(item.title)) })),
  ...['flipper-zero', 'meshtastic', 'meshcore', 'lora+hardware', 'open-source-hardware+esp32', 'wifi-security+hardware', 'sdr+hardware', 'rfid+hardware', 'hardware-hacking', 'pentest-hardware', 'cyberdeck', 'badusb'].map(topic => ({ id: `github:${topic}`, label: `GitHub topics ${topic}`,
    url: `https://api.github.com/search/repositories?q=${topic.split('+').map(t => `topic:${t}`).join('+')}&sort=updated&per_page=30`,
    parse: json => JSON.parse(json).items.filter(r => !r.fork && r.stargazers_count >= 10).map(r => ({ url: r.html_url, title: `${r.full_name} — ${r.description || ''}`.slice(0, 160), stars: r.stargazers_count })) }))
];

const catalog = JSON.parse(await fs.readFile(path.join(root, 'data/catalog.json'), 'utf8'));
const candidates = JSON.parse(await fs.readFile(path.join(root, 'data/candidates.json'), 'utf8'));
const known = new Set([...catalog.flatMap(d => [d.source, ...(d.extraSources || []).map(s => s.url)]), ...candidates.map(c => c.url)].filter(Boolean).map(normalize));
const knownNames = new Set(catalog.map(d => d.name.toLowerCase()));
function normalize(url) { try { const u = new URL(url); return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`.toLowerCase(); } catch { return url; } }

const seen = new Set(), fresh = [], failures = [];
for (const source of sources) {
  try {
    const response = await fetch(source.url, { headers: ua, signal: AbortSignal.timeout(20000) });
    if (!response.ok) { failures.push(`${source.label}: HTTP ${response.status}`); continue; }
    for (const item of source.parse(await response.text())) {
      const key = normalize(item.url);
      if (seen.has(key) || known.has(key) || knownNames.has(item.title.toLowerCase())) continue;
      seen.add(key); fresh.push({ source: source.label, ...item });
    }
  } catch (error) { failures.push(`${source.label}: ${error.message}`); }
}

if (process.argv.includes('--json')) { console.log(JSON.stringify({ checked: new Date().toISOString().slice(0, 10), fresh, failures }, null, 2)); }
else {
  console.log(`${fresh.length} items not yet considered (${sources.length} sources, ${failures.length} failed)\n`);
  for (const source of new Set(fresh.map(f => f.source))) {
    console.log(`## ${source}`);
    for (const item of fresh.filter(f => f.source === source)) console.log(`- ${item.title}${item.stars ? ` (★${item.stars})` : ''}\n  ${item.url}`);
    console.log();
  }
  for (const failure of failures) console.log(`! ${failure}`);
  console.log('\nRecord decisions in data/candidates.json so they do not reappear.');
}
