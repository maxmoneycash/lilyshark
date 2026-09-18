# Finding hardware for the catalog

Until now devices came in two ways: Max sent a link, or a research pass went looking. That misses most of what launches each week. This is the standing process.

## What belongs

Pocket-sized hardware a radio or hardware hobbyist would carry or build, where at least one of these is true:

- it has a radio: Wi-Fi, Bluetooth, LoRa or Meshtastic, sub-GHz, RFID/NFC, SDR, GPS;
- it is a security, monitoring or field tool (scanning, detection, capture, testing);
- it is open hardware a hobbyist can build from the published files.

Not in scope: children's STEM kits, plain breadboard learning kits, pure software, desktop lab gear, and anything with no way to buy or build it. When something is out of scope but has a good idea in it, record the idea in `data/candidates.json` under `worthCopying`.

## Where new hardware shows up

| Source | How we watch it |
|---|---|
| Lectronz newest listings | `scripts/scout.mjs` |
| Crowd Supply browse | `scripts/scout.mjs` |
| Hackaday.io tags (meshtastic, flipper-zero, esp32, lora, sdr, rfid, wifi, hacking) | `scripts/scout.mjs` |
| GitHub topics (flipper-zero, meshtastic, meshcore, lora, open-source-hardware, wifi-security, sdr, rfid) | `scripts/scout.mjs` |
| **Tindie** new products and categories | Blocks automated reads. Open in a browser weekly: Wireless, Security, IoT categories sorted by newest. |
| Kickstarter Technology › Gadgets | Blocks automated reads. Browser, weekly. |
| Reddit: r/flipperzero, r/meshtastic, r/RTLSDR, r/hackingtools, r/esp32 | Browser, weekly. Sort by top this week. |
| YouTube, TikTok, Instagram creators who unbox this hardware | Follow the list in `docs/research/creator-marketing-2026-09-16.md`. |
| Maker stores already in the catalog (463n7, Colonel Panic, PINGEQUA, Rabbit-Labs, InfiShark…) | Their "new" pages, monthly. |
| Suggestions from visitors | Not built yet. A **Suggest hardware** link is the cheapest next step. |

## Weekly routine

1. `node scripts/scout.mjs` — prints everything on the automated sources that is not in the catalog or in `candidates.json`.
2. Browse Tindie, Kickstarter and Reddit by hand for the same.
3. For each item, decide: **list**, **skip** (with a reason), or **watch** (crowdfunding not yet delivered, no price yet).
4. Write the decision into `data/candidates.json`. Skipped items never reappear in the scout output; watched ones get a `revisit` date.
5. Listed items go through the normal catalog entry: primary-source specs, dated review, photo with credit, gaps stated.

## Why decisions are recorded

Without a record, the same product gets re-evaluated every week and nobody knows why something was left out. `candidates.json` is that record. It is also where a future public "considered but not listed" page would come from.

## Weekly money check

Run `node scripts/coverage.mjs --gaps` alongside the scout. It prints how many devices can earn (affiliate or Buy button), which programs cover the most devices, and — with `--gaps` — every device that currently has no way to earn, grouped by the merchant that sells it.

Use the gap list two ways:
1. **Find a reseller.** If a merchant has no program, look for a reseller that stocks the same device and does. That is how Lab401 came to cover 22 devices whose makers pay nothing.
2. **Pick pilot targets.** A maker with no program anywhere, who sells direct and answers email, is a Buy-button prospect (`docs/buy-pilot.md`).
