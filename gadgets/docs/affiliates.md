# Affiliate links

Device pages link to the maker's website. When an affiliate program in `data/affiliates.json` is active, that link becomes **Buy from {merchant}** instead, carries the affiliate ID, uses `rel="sponsored"`, and a one-line disclosure appears under it. Nothing changes on any page until an ID is added.

## Turning a program on

1. Apply with the merchant (links below). Approval is theirs, not ours.
2. Open `data/affiliates.json` and find the program.
3. Put the ID the merchant issued in `affiliateId`.
4. For `param` programs, also set `param` to the query-parameter name from a referral link in the merchant's dashboard (for example the `xyz` in `?xyz=YOURCODE`).
5. Run `npm run build`. The build fails if the file is malformed.

`redirect` programs (Awin: Elecrow, CircuitMess) already have their link template; only the ID is needed.

## Apply in this order

1. **Awin** — https://ui.awin.com/publisher-signup/us/awin/step1 — $1 refundable deposit, no traffic minimum. One dashboard covering Elecrow, CircuitMess, GL.iNet and AliExpress.
2. **Lab401** — email support@lab401.com — 10% across 22 devices, the most valuable single program we found.
3. **Sovrn Commerce** — https://platform.sovrn.com/account/signup?path=commerce — a link aggregator that monetises the ~56 devices no individual program reaches. See `docs/research/affiliate-networks-2026-09-17.md` for the tradeoffs.
4. **Seeed** and **Impact.com** (for GL.iNet).
5. **Confirm Elecrow's network first** — marketing@elecrow.com.

## Where to apply

| Program | Apply | Notes from the September 16 research |
|---|---|---|
| Seeed Studio | https://www.seeedstudio.com/blog/affiliate-program/ | 3% base, XIAO 8%, 45-day cookie; $50 minimum payout, quarterly |
| Elecrow (Awin 82721) | https://ui.awin.com/publisher-signup/us/awin?advertiser=82721 | 5–10%; maker/partner-seller products excluded |
| CircuitMess (Awin 124978) | https://ui.awin.com/merchant-profile/124978 | rate not published; same Awin publisher ID as Elecrow |
| LILYGO (BixGrow) | https://lilygo.bixgrow.com/register/h569 | 2% |
| DFRobot | https://www.dfrobot.com/affiliates | 3%, rising with volume; $50 minimum |

Full findings: `docs/research/affiliate-partnerships-2026-09-16.md`.

## Coverage

A device only gets a paid link when its `source` (or an optional `buy` field) points at the merchant's store. Three Seeed devices currently cite `wiki.seeedstudio.com`; add a `buy` URL to those catalog entries for the store page once the program is live.

## Rules that keep us honest

- Never activate a program before the merchant has approved us.
- The disclosure stays on every paid link; do not remove it.
- Affiliate status never affects which devices are listed or how they are described.

## Programs added 2026-09-17

| Program | Apply | Notes |
|---|---|---|
| GL.iNet | https://www.gl-inet.com/en-us/pages/affiliate-program | up to 10% via Awin, Tradedoubler or Impact; paste the network's deep-link template into `data/affiliates.json` |
| Lab401 (EU) | email support@lab401.com, terms at https://lab401.com/pages/lab401-affiliate-program-tos | 10%; covers HackRF, Proxmark, Chameleon, Bus Pirate, CatSniffer; Flipper Zero excluded |

Full survey of all 50 makers and 17 resellers: `docs/research/affiliate-programs-2026-09-17.md`.

## Reselling: earning on hardware whose maker pays nothing

Many makers in the catalog run no program (Flipper Devices, Great Scott Gadgets, Proxmark, Heltec, Airspy, Raspberry Pi…). We still earn on those by pointing the device's `buy` field at a **reseller that does** pay. Lab401 covers 22 devices this way.

Set `buy` on the catalog entry to the reseller's product page; `source` stays the maker's page. The device page then shows **both**: a tagged "Buy from {reseller}" link and the maker's own shop. That matters because most paying resellers are regional — sending a US buyer to an EU shop as their only option would be worse than earning nothing.

Check coverage any time with `node scripts/coverage.mjs --gaps`.
