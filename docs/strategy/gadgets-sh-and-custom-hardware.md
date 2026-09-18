# gadgets.sh and a custom LilyShark device

Recorded September 13, 2026, after reviewing the user's `Downloads/files (23).zip`.

## Founder intent

The user wants to make money from a hacking-gadget business and ultimately design and sell their own physical device running their firmware. A LILYGO T-Deck running LilyShark is the current development platform and a potential catalog entry, not the intended final hardware product.

The user also wants to build **gadgets.sh**: a clean gallery and wiki designed for mobile browsing, covering hacking gadgets from many manufacturers. It should include both the LILYGO hardware running LilyShark and the user's eventual original device. Domain availability and purchase terms have not been checked in this review.

The Multicoin paper is a related research and investor-outreach project about the future of consumer mesh networks. It must not override the goal of making a sellable consumer gadget. Shelby's existing purpose is capture storage and sharing; its storage workflow already uses Aptos. These integrations do not require inventing a new token or capture marketplace.

## What the archive contains

- `reels-standalone.html`: a self-contained gallery with embedded data and styles.
- `devices.js`: 44 device entries, matching the embedded dataset.
- `images.js`: 10 product-photo URLs, matching the embedded image map.

All entries were reviewed, and the gallery was opened in Arc at a 390 by 844 viewport. The visual direction uses full-screen vertical cards, a dark background, cream text, condensed titles, colored capability tags, a specification table, expandable details, and bottom filters.

The collection spans Flipper-style multitools, wardriving hardware, dedicated radio instruments, mesh communicators, pocket computers, and DIY kits. Examples include Flipper Zero, Kode Dot, Cardputer Zero, Mecha Comet, High Boy, Biscuit Ultra, CatSniffer, YARD Stick One, Proxmark3, PocketMage, The Hacker Pager, and CircuitMess kits. The scope is substantially broader than LoRa.

The current implementation is a gallery prototype. It has no search, individual device URLs, comparisons, wiki revision history, or commerce tracking. Thirty-four entries have no photo URL. Ten entries link only to a generic Kickstarter homepage or `#` instead of a specific product. Long details introduce nested scrolling; in the reviewed Hacker Pager card, expanding details produced an overlap between the product image and description.

## Product structure

Keep three identities clear:

1. **gadgets.sh:** the multi-manufacturer discovery and reference site.
2. **LilyShark firmware:** software that runs on identified compatible hardware.
3. **The original device:** a future product with its own board, enclosure, controls, manufacturing cost, and support obligations.

The exact original-device specification is not decided. Calling it a hacking gadget establishes a category, not a complete product definition. The next hardware brief must specify who buys it, the experiments it makes easy, its advantage over alternatives, and a price/cost target that includes fulfillment and support.

Catalog hardware and firmware separately. A LILYGO T-Deck Plus entry can show LilyShark as compatible firmware, with a linked installation guide. A future original device should have its own entry and explicit prototype/development status. Do not imply LILYGO hardware was designed by LilyShark.

## Relevant competitive finding

[The Hacker Pager's manufacturer](https://shop.exploitee.rs/shop/p/the-hacker-pager) lists a starting price of $250 and describes standalone Meshtastic messaging, LoRa PCAP capture to SD, spectrum tools, and an ESP32-S3/SX1262 platform. Its [project site](https://www.hackerpager.net/) provides open hardware and firmware information. This is a particularly close benchmark for the existing LilyShark direction.

The price is a listed offer, not evidence of sales volume or profitability. The overlap means a new device needs a defensible reason to choose it. A clearer interface, better capture workflow, useful support for multiple mesh protocols, or a different physical form are candidates to demonstrate, not established advantages.

The catalog is useful for identifying this competition before committing to a PCB. It does not establish that a gap exists simply because a particular feature combination is absent.

## Making the gallery into a useful wiki

Preserve the visual feed for discovery, and add a searchable index plus a permanent page for each device. Detail pages should answer what someone can actually do, required accessories/host devices, firmware options, known limitations, and where to buy.

Separate **device category** from **availability**. The current single `tier` mixes `shipped`, `funded`, and `failed` with `instrument`, `consumer`, and `kits`; a shipped instrument should be represented in both dimensions.

Each material claim needs a source and a checked date. Distinguish manufacturer specifications, advertised future features, and independently tested behavior. Prices need currency and configuration. Crowdfunding totals are not profits or proof of delivery. The archive includes judgments about failed products and purported defects without claim-level sources; those require verification and factual wording before publication.

Use the same evidence standards for the founder's own products. Clearly identify that ownership and label paid placements so visitors can assess recommendations.

## Revenue hypotheses

**The site:** affiliate commissions where a merchant has a program and accepts the site, plus clearly labeled sponsorships once an audience exists. Track qualified product visits, outbound purchase clicks, and attributable completed purchases. A gallery's popularity alone does not establish revenue. Affiliate rates and sponsorship demand have not been established in this review.

**The device:** sales of the original hardware, followed by genuinely useful accessories or services if demand emerges. A custom enclosure or PCB can improve the product, but being custom does not by itself establish willingness to pay.

For each hardware unit, estimate contribution after landed components, assembly and QA, packaging, payment fees, shipping subsidy, returns, and support. Development, tooling, and other fixed launch costs must then be recovered from those contributions. List price minus parts cost is not profit.

gadgets.sh could help the hardware business reach relevant buyers and learn what they want. This is a proposed distribution strategy, not a forecast that visitors will buy LilyShark.

## Recommended sequence

1. Turn the archive into a source-checked gallery/wiki MVP, preserving its mobile visual direction and adding permanent device pages, search, real images, and useful purchase links.
2. Publish a clearly attributed LilyShark-on-T-Deck entry and build log. Use the T-Deck to demonstrate firmware and capture workflows while preparing the original-device specification.
3. Compare the intended original device against the closest alternatives using real tasks and prospective gadget buyers. Resolve the hardware specification, cost targets, and engineering tradeoffs before committing to production.
4. Build and validate custom hardware, then sell a supportable first batch with measured costs. Investor outreach can use the resulting research, audience, and product evidence.

The initial review did not modify the supplied archive. A subsequent local implementation is now in [gadgets/](../../gadgets/README.md): a gallery, searchable index, 45 permanent device pages including the explicitly labeled original-hardware concept, saved devices, comparisons, and a separate LilyShark firmware article. The first 44 records come from the archive. The [2026-09-14 catalog review](../../gadgets/docs/catalog-review-2026-09-14.md) checked all 44: 41 retain source-checked claims, three remain partial, and all 44 have credited source images. Unknown specifications and revision caveats remain explicit.

The [original-device brief](lilyshark-original-device-brief.md) makes the proposed first buyer, defining workflow, competition, architecture decisions and contribution model reviewable. No domain has been purchased, site published, or hardware production commissioned.
