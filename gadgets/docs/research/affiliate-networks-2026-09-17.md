# Where else the money could come from

Research date 2026-09-17, read-only, official pages only. Companion to `affiliate-programs-2026-09-17.md`, which covered the makers. This one covers **resellers, networks and link aggregators** — the routes to earning on the ~56 devices whose makers pay nothing.

## The headline finding

**European maker and radio retail does not do affiliate marketing.** Nineteen EU/UK resellers were checked — Botland, BerryBase, Kiwi Electronics, Welectron, Elektor, Passion Radio, SDR-Kits, Cool Components, Electromaker, Rapid Electronics, HackmoD, AstroRadio, RoboSavvy and others. **Not one runs a commission program.** Every "partner" page turned out to be a B2B wholesale or dealer scheme: buy stock at trade prices and resell. Passion Radio's is a 5% discount for French radio clubs. Elektor's "Reseller Program" is a dealer form.

Lab401 is the exception that proves the rule, and it is already in hand.

US retail is no better: PiShop, Vilros, CanaKit, OzHack, NooElec, Pololu, Adafruit and DigiKey all have nothing. Only Fab.to.Lab (India) has an open self-serve program, and its rate is not published.

**So chasing more individual reseller programs has hit diminishing returns.** Two routes remain.

## Route 1: link aggregators (the real answer to "more affiliates")

Instead of joining forty programs, one JavaScript snippet rewrites *every* outbound link into a commissionable one, across tens of thousands of merchants.

| | **Sovrn Commerce** (ex-VigLink) | **Skimlinks** (Taboola) |
|---|---|---|
| Merchants | 50,000+ | 48,500 across 50+ networks |
| Traffic minimum | **None published** | "Significant" traffic from NA/EU/APAC or they may decline |
| Approval | ~24 hours | Entirely at their discretion, no reason given |
| Revenue share | **Not published** | **Not published** |
| Payout minimum | $25 ACH / $50 wire | $65 / £50 / €55 |
| Payout delay | **90 days** after month end | **92 days**, or 30 days after they are paid |
| Disclosure | Must label promotional content | Must follow FTC and UK ASA rules |
| Signup | platform.sovrn.com | skimlinks.com/signup |

**Verdict: apply to Sovrn first.** No stated traffic floor and fast approval make it the only option that works for a site with no audience yet. Skimlinks is worth applying to in parallel but may reject a pre-traffic site outright.

**The honest tradeoffs.** The revenue share is invisible until you are inside, so you cannot model it. Payment arrives roughly three months late. And it means putting third-party JavaScript on a site that currently ships none — it rewrites links at runtime, sees every outbound click, and adds a dependency to pages that are otherwise static. For a site whose pitch is careful, sourced, honest documentation, that is a real cost, not just a technical one. My read: worth it for the long tail of 56 devices, but keep the hand-built programs (Lab401, Seeed, GL.iNet) as direct links, since they pay more and are under our control.

## Route 2: networks worth joining directly

- **Awin** — $1 refundable deposit, **no traffic minimum**, accepts any site with working links. This is the single path to Elecrow, CircuitMess, GL.iNet and AliExpress's Awin program. Lowest-risk action available.
- **Impact.com** — free self-serve signup with a browsable product marketplace; GL.iNet runs its program here.
- **eBay Partner Network** — the only network whose real rate card was readable: Computers/Tablets/Networking **1.5%**, Electronics **2.0%**, Collectibles 3%, All Other 4%, each capped at $550 per transaction, 24-hour cookie, paid monthly. Thin, and only useful for used or discontinued hardware.
- **Partnerize** — no relevant brands found; skip.

### Finding programs we do not know about

Shopify affiliate apps run publisher-facing marketplaces where small maker shops list their own programs:

- **UpPromote Marketplace** (uppromote.com/marketplace) — the best documented; listings show commission, cookie window and categories.
- **Refersion Marketplace** (marketplace.refersion.com) — plausible but its contents could not be read without a browser.
- **BixGrow Marketplace** — smallest; LILYGO's program runs on BixGrow.
- **GoAffPro** — claims 50,000 merchants, but no browsable directory could be confirmed.
- **Social Snowball** — publisher marketplace is still a waitlist; not usable.

These are worth a browser pass: searching them for "ESP32", "LoRa", "SDR" or "pentest" may surface maker shops with programs nobody has catalogued.

## Amazon Associates: rates unverified

Every route to Amazon's fee schedule is behind a sign-in wall; the public Operating Agreement contains no percentages at all. **The commonly quoted 2.5–4% for electronics could not be confirmed on 2026-09-17.** What is confirmed from public terms: 24-hour cookie, $10 minimum by direct deposit, paid ~60 days after month end, and the account closes if it makes no qualifying sale within 180 days. Check the real card inside an account before relying on a number.

## What to actually do, in order

1. **Join Awin** ($1, no minimum) — unlocks Elecrow, CircuitMess, GL.iNet, AliExpress in one dashboard.
2. **Email support@lab401.com** — 10% across 22 devices, our single most valuable program.
3. **Apply to Sovrn Commerce** — covers the long tail no individual program reaches.
4. **Apply to Seeed** direct, and **Impact.com** for GL.iNet.
5. **Confirm Elecrow's network** (marketing@elecrow.com) before pasting an ID — their page says ShareASale, which Awin folded in late 2025, while the Awin profile says active.
6. Amazon Associates and AliExpress Portals once there is traffic worth the paperwork.
7. Browser pass over the UpPromote and Refersion marketplaces to find unknown maker programs.

## Blocked, needs a browser

Antratek, WiMo, Konektor, OKdo, Micro Center, Core Electronics, Robu.in, Hacker Warehouse, Sneak Technology and the Awin advertiser directory all refused scripted reading (403, timeouts, TLS mismatch or client-side rendering). The "7Lab" reseller listed by Great Scott Gadgets could not be identified — its domain does not resolve. Neven.nl is now a parked domain and should be dropped.
