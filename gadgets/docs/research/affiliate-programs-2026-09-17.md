# Affiliate programs across the whole catalog

Checked 2026-09-17 by six parallel research passes over official pages only; one conflicting result (Lab401) was re-verified by hand. Structured data: `affiliate-programs-2026-09-17.json`. Nothing was applied for. All rates are what merchants publish today; they change.

## The short version

Of the **50 makers** behind the 76 devices, **7 have an affiliate program you can join today**, 1 is invite-only by proxy (Hak5, via resellers), 2 are closed, 1 is unclear, and **39 have nothing**. Among **17 resellers and marketplaces**, 5 pay commission (Amazon, AliExpress, eBay, Lab401, SparkFun), 1 is invite-only (Hak5), 1 is behind a login (Hacker Warehouse), and the rest run wholesale programs only.

The money is concentrated in a handful of places:

| Program | Pays on | Rate | Cookie | Payout | Covers in our catalog |
|---|---|---|---|---|---|
| **Seeed Studio** (direct) | own store | 3% base, XIAO 8%, displays 5–10% | 45 d | $50 min, quarterly | 4 devices + Great Scott Gadgets resale |
| **Elecrow** (Awin 82721) | own store | 5–10% (site says up to 20%) | 30 d | via Awin | ThinkNode M1/M2 + 7 CircuitMess kits sold there |
| **GL.iNet** (Awin/Tradedoubler/Impact) | own store | up to 10% | ? | via network | Beryl AX |
| **DFRobot** (direct) | own store | 3% → 6% → 8% | ? | $50 min, 7 days on request | HuskyLens 2 |
| **Lab401** (direct, EU) | own store | 10% (or split with a customer discount) | ? | €10 min, monthly | HackRF, YARD Stick, Cynthion, Proxmark, Chameleon, Bus Pirate, CatSniffer — **not** Flipper Zero |
| **LILYGO** (BixGrow) | own store | 2% | 30 d | periodic | T-Deck Plus, T-Echo, T-Beam Supreme, T-Embed |
| **CircuitMess** (Awin 124978) | own store | not published | 30 d | via Awin | 7 kits |
| **Amazon Associates** | Amazon | ~2.5–4% by category | 1 d | $10, monthly +60 d | RTL-SDR, Raspberry Pi, LILYGO, Heltec, Seeed, M5Stack listings |
| **AliExpress Portals** | AliExpress | ~3–4% electronics | 3 d | unclear | LILYGO and M5Stack official stores |
| **eBay Partner Network** | eBay | ~1.5–2.5%, capped | 1 d | $10, monthly | used/secondary market |

Not worth the time: SparkFun (10%, but only on SparkFun's own products), Hak5 (invite-only, and only Hak5 gear), RAKwireless (published 5%/180-day terms but the Kickbooster signup says it isn't accepting new affiliates), Saleae (2018 trial is gone).

## What this means for revenue

Only **17 of 76 devices** can currently earn through a maker's own program, and most of those pay 2–10% on items priced $20–$200. That is a few dollars per sale. Amazon and AliExpress widen coverage a little, at lower rates, and both are risky in this category because the listings are full of clone hardware; link only to official brand stores.

Flipper Zero, the single most-searched device in the catalog, earns nothing anywhere: Flipper sells direct with no program, is banned from Amazon, and is excluded from Lab401's program.

The pattern across the 39 makers with no program is consistent: small teams, Kickstarter-first launches, Shopify stores with no affiliate app installed. They don't have a program because nobody asked. That is the opening for the pilot — a **Buy on gadgets.sh** button (Stripe Connect, 5% platform fee) pays more than any affiliate rate above and needs nothing from the maker but a Stripe onboarding link.

## Every maker

Status key: **open** = you can apply today · **closed** · **unclear** · — = no program found.

| Maker | Devices | Status | Program | Storefront | Notes |
|---|---|---|---|---|---|
| 463n7.io | 2 | — | | Shopify | No contact page; social links only |
| Airspy | 1 | — | | custom | Sells via distributors and Amazon |
| AntiHunter | 1 | — | | Lectronz | devteam@rootdowndigital.com |
| Arduino | 1 | — | B2B partners; reseller at $10k/yr | Shopify | |
| BegoonLab (Meshimi) | 1 | — | | Kickstarter | Not sold yet |
| Biscuit Shop | 1 | — | Patreon for early stock | Shopify | admin@biscuitshop.us |
| CircuitMess | 7 | **open** | Awin 124978, 30 d, rate unpublished | Shopify | contact@circuitmess.com |
| Colonel Panic | 2 | — | | WooCommerce | Left Tindie; sells only direct |
| Cyper Device | 1 | — | | Kickstarter | Own domain is parked |
| Dangerous Prototypes | 1 | — | | DirtyPCBs + resellers | Links carry ?ref= but no public program |
| DFRobot | 1 | **open** | Direct: 3/6/8%, $50 min, 30-day lock | custom | |
| Digilent | 1 | — | Distributors, academic discount | unknown | Site blocks bots |
| Elecrow | 2 (+7 CircuitMess) | **open** | Awin 82721: 5–10%, 30 d; site says up to 20% | Magento | marketing@elecrow.com; Partner Seller marketplace takes 5% |
| Electronic Cats | 1 | — | Distributors: Hacker Warehouse, KSEC, Lab401, OzHack | WooCommerce | |
| ENIAC / ENILINX | 1 | — | | Shopify | contact@eniacelec.com |
| Espressif | 1 | — | | distributors | |
| Eurolan (ggtag) | 1 | — | | Crowd Supply | |
| exploitee.rs | 1 | — | | Squarespace | orders@exploitee.rs; sells at DEF CON |
| Flipper Devices | 2 | — | Regional resellers only; banned from Amazon | Shopify | No affiliate anywhere |
| GL.iNet | 1 | **open** | Awin + Tradedoubler + Impact, up to 10% | Shopify | presale@gl-inet.com |
| Great Scott Gadgets | 5 | — | Sells only via resellers | custom | Earn via Lab401 (EU) or Seeed |
| Heltec | 2 | — | | custom | Official AliExpress store |
| High Code | 1 | — | | Indiegogo | Pre-launch |
| Honey Honey Team | 1 | — | | Tindie | $99 on Tindie |
| InfiShark | 1 | — | | Shopify | support@infishark.com |
| Interrupt Tech | 1 | — | | Webflow | Pre-launch; business@interrupt-tech.com |
| KODE DIY | 1 | — | | Shopify | Valencia, Spain |
| LILYGO | 4 | **open** | BixGrow: 2%, 30 d | Shopify | info@lilygo.cc; hardware-gift 'Activity Program' |
| M5Shark | 2 | — | | Shopify | support@m5shark.com |
| M5Stack | 2 | — | Distributors at $5k/month | Shopify | |
| Mecha Systems | 1 | — | | custom | Preorder, ships ~Jan 2027 |
| MonstaTek | 1 | — | | Kickstarter | No store |
| NanoRFE | 1 | — | | custom | info@nanorfe.com |
| Oddly Specific Objects | 1 | — | | Crowd Supply | Own shop closed |
| PINE64 | 1 | — | 'Affiliates' page is a reseller list | WooCommerce | |
| PINGEQUA | 1 | — | BUILD10 is a public discount, not tracked | Shopify | support@pingequa.com |
| POOM | 1 | — | | Kickstarter | |
| Product71 (Click) | 1 | — | | none | Nothing for sale |
| Rabbit-Labs EU | 1 | — | | Tindie | Out of stock since Aug 2026 |
| Radiacode | 1 | unclear | 'Partnership' → core@radiacode.com | headless Shopify | Cyprus; on Amazon |
| RAKwireless | 1 | closed | 5%, 180 d, $20 min — but Kickbooster not accepting | Shopify | Recheck in a browser; reseller program open |
| Raspberry Pi | 3 | — | Approved Resellers only | custom | Earn via Amazon only |
| RFID Research Group | 2 | — | Sells via Lab401 and Hacker Warehouse | custom | Earn via Lab401 |
| RTL-SDR Blog | 1 | — | Wholesale at 10+ units | WooCommerce | They are an Amazon affiliate themselves |
| Saleae | 1 | closed | 2018 trial gone; informal 'small gift' referral | custom | |
| Seeed Studio | 4 | **open** | Direct: 3% base, XIAO 8%, 45 d, $50, quarterly | Magento | affiliate@seeed.cc; mesh rates 'competitive', 12% no longer stated |
| Talisman Design | 1 | — | | Crowd Supply | |
| TechxArtisan | 1 | — | Crowd Supply exclusive to mid-2026 | custom | Also on Amazon |
| whitecliff / MeowKit | 1 | — | | Shopify | $1.5M Kickstarter |
| LilyShark | 1 | — | | ours | |

## Resellers and marketplaces

| Reseller | Region | Program | Rate | Notes |
|---|---|---|---|---|
| Amazon Associates | US | open | ~2.5–4% | 24 h cookie; $10 min; paid ~60 days after month end |
| AliExpress Portals | global | open | ~3–4% | 3-day cookie; counterfeits everywhere; link to official stores only |
| eBay Partner Network | global | open | ~1.5–2.5% | 24 h cookie; rate card is an image |
| Lab401 | EU/UK | open | 10% | Excludes Flipper Zero; white-hat content only; monthly from €10 |
| Hacker Warehouse | US | unclear | ? | Program exists since 2014, terms behind login; email support |
| SparkFun | US | open | 10% | SparkFun Originals only — useless for us |
| Hak5 | global | invite-only | 10–20% | Only Hak5 gear; codes never public |
| KSEC Labs | UK/EU | — | | Tiered wholesale only |
| Adafruit | US | — | | Never runs affiliate programs (stated since 2009) |
| The Pi Hut, Pimoroni | UK | — | | Wholesale only (Pimoroni £1,000 minimum) |
| Mouser, DigiKey | global | — | | No content-affiliate programs |
| Tindie | global | — | | Seller fee 5%; no publisher program |
| Lectronz | EU | — | | Seller fee 5%; first 5 orders free; no publisher program |
| Crowd Supply | US | — | | 12% + 3.75% creator fees; handles fulfillment; no publisher program |
| Kickstarter | global | — | | Kickbooster is per-campaign, opt-in |

## Recommended order

1. **Apply to Seeed, Elecrow (Awin), GL.iNet and Lab401** this week. Elecrow's Awin approval also unlocks CircuitMess. That covers 21 devices at 3–10%.
2. **Amazon Associates** for Raspberry Pi and RTL-SDR only, linking to the RTL-SDR Blog official store and Raspberry Pi approved resellers.
3. **Email Hacker Warehouse** (support@hackerwarehouse.com) to ask for the affiliate terms; they stock more of our security hardware than anyone in the US.
4. Skip LILYGO's 2% and DFRobot until traffic justifies the paperwork.
5. Everyone in the "—" column is a **Buy on gadgets.sh** prospect, not an affiliate prospect. Start with the makers who already answer email: Colonel Panic, InfiShark, PINGEQUA, AntiHunter, ENIAC, exploitee.rs.

## Caveats

- Rates were read from public pages; several networks hide the exact rate until approval (CircuitMess, GL.iNet).
- Kickstarter, Digilent and the Kickbooster page block automated reading; RAKwireless's status deserves a browser check.
- One research pass reported Lab401 as having no program; the terms page was fetched directly and confirmed, so that pass was wrong.
- Amazon's category table has no "Electronics" line; which rate a board earns depends on Amazon's own categorisation.
