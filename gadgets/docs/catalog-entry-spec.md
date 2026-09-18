# How to write a catalog entry

Every device needs three records plus a photo. Proposals from research passes go in `data/catalog-expansion-proposal-<batch>-<date>.json` as `{ "catalog": [...], "details": { slug: {...} }, "images": { slug: {...} } }` and are merged by `scripts/merge-proposal.mjs`, which runs the same validation as the build. Never edit `data/catalog.json`, `device-details.json` or `images.json` directly in a research pass.

## Scope

Pocket-sized hardware a radio or hardware hobbyist would carry or build: it has a radio (Wi-Fi, BLE, LoRa/Meshtastic, sub-GHz, RFID/NFC, SDR, GPS), or it is a security/monitoring/field tool, or it is open hardware a hobbyist can build from published files. Not: children's STEM kits, bare sensor breakouts, desktop lab gear, pure software, anything with no way to buy or build it.

## Rules

- **Primary sources only.** Specs come from the maker's product page, docs, README or schematic. Never from resellers' copy, forums, news articles or memory. Every fact row cites the page it came from.
- **Say what is unknown.** `gaps` lists what the sources don't state (battery, dimensions, band options, price...). Don't guess.
- **Dated.** `checked`, `reviewed`, `added` are ISO dates of the day you read the source.
- **Plain language.** Descriptions are one sentence a hobbyist would say. No marketing adjectives ("powerful", "revolutionary").
- **No hands-on claims.** `testedByUs` is `false` unless we physically tested it.
- **Photo** is the maker's own image, resized to ≤1600 px wide as JPEG at quality 82, saved as `public/assets/<slug>.jpg`, with its SHA-256 recorded. Note the licence situation in `usage`.

## catalog entry

```json
{
  "slug": "kebab-case",                      // unique, [a-z0-9-]
  "name": "Device Name",
  "maker": "Maker Name",
  "category": "boards|computers|instruments|kits|multitools|radio|rfid|wearables|wifi",
  "status": "listed|preorder|crowdfunding|development|soldout|unknown|concept",
  "description": "One plain sentence.",
  "tags": ["3–5 short tags"],
  "specs": { "processor": "...", "display": "...", "radio": "...", "power": "..." },
  "price": "US$99" | null,                  // only if read from the maker's store today
  "source": "https://...",                  // the primary page (maker store, repo or docs)
  "sourceLabel": "Maker product page",
  "buy": "https://...",                      // optional: store page if source is docs/repo
  "checked": "YYYY-MM-DD", "verified": true, "reviewed": "YYYY-MM-DD", "added": "YYYY-MM-DD",
  "verificationNotes": ["≥2 sentences: what was read, from where, what's uncertain"],
  "extraSources": [{ "label": "...", "url": "https://..." }],
  "usage": {
    "tasks": ["build|computers|mesh|radio|rfid|wifi"],
    "format": "addon|board|computer|handheld|kit|phone",
    "goodFor": "One sentence.", "needs": "One sentence.", "tradeoff": "One sentence.",
    "capabilities": ["ble|gnss|hf|lf|lora|meshtastic|sdr|subghz|wifi5"]
  }
}
```

## details entry (keyed by slug)

```json
{
  "reviewed": "YYYY-MM-DD", "coverage": "reviewed|unconfirmed", "testedByUs": false,
  "sections": [{ "title": "Hardware", "rows": [{ "label": "...", "value": "...", "source": "https://...", "reviewed": "YYYY-MM-DD" }] }],
  "resources": [{ "label": "...", "url": "https://...", "reviewed": "YYYY-MM-DD" }],   // every row.source must appear here; https only; unique
  "gaps": ["..."], "notes": ["Reviewed at commit … / page dated …"]
}
```

Aim for 3–5 sections and 10–20 rows: hardware, connectivity, firmware/software, buying (price, tiers, stock, warranty), licence/compliance.

## images entry (keyed by slug)

```json
{ "source": "https://exact-image-url", "sourcePage": "https://page-it-came-from", "caption": "Maker product photo …", "path": "/assets/<slug>.jpg", "retrieved": "YYYY-MM-DD", "width": 1600, "height": 1066, "sha256": "…", "credit": "Maker Name", "usage": "Local preview; commercial reuse not cleared" }
```

Use `sips -s format jpeg -Z 1600 -s formatOptions 82 in.png --out public/assets/<slug>.jpg` and `shasum -a 256`.
