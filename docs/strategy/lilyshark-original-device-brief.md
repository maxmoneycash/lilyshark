# LilyShark: first original device brief

2026-09-14 · Working proposal, not a final hardware specification

The commercial goal is to sell a device we design: our own PCB, enclosure, controls and firmware. T-Deck hardware is a development platform. gadgets.sh is a separate discovery and wiki product that can build an audience and carry an explicitly identified listing for our device.

## First buyer and defining experience

Start with the enthusiast who already likes programmable handhelds and wants to explore local radio and mesh networks without opening a laptop for every step. This is a proposed buyer segment to test, not a demonstrated market size.

Prototype one complete session: turn the device on, select a supported radio profile, understand the packets the receiver can hear, exchange a test message where supported, save the session, then reopen it in a useful analysis interface. The device should also be enjoyable as an everyday handheld; an attractive object, good controls and dependable firmware can matter to a consumer buyer.

Reception, protocol decoding and reading encrypted message content are different capabilities. Public channel keys make some content readable. That does not make all LoRa traffic public, and private messages should not be advertised as arbitrarily decryptable. The product promise is a good radio experience, not a secret ability to read everything.

## Why someone would buy this instead of an existing device

The closest current comparison is [The Hacker Pager](https://www.hackerpager.net/), which already combines mesh messaging, LoRa capture and radio tools. Its [store](https://shop.exploitee.rs/shop/p/the-hacker-pager) listed a starting price of $250 and sold-out availability at the 2026-09-14 check. Those facts establish an offer, not sales volume or a proven willingness to pay for LilyShark.

The differentiation to test is **a better integrated handheld experience for exploring and using supported meshes**: a clear packet view, fast controls for real message entry, understandable radio settings, reliable capture and a useful path from device to analysis software. “It sniffs LoRa” and a longer list of unfinished tools will not distinguish it from this competitor.

Run the same session on a T-Deck LilyShark prototype and the available competing device. Record task completion, mistakes, time, comfort and what buyers actually prefer. Ask what they would stop using and what they would pay for the finished device. Interest in the category, compliments on the UI and a mailing-list signup are weaker evidence than choosing this particular product at a real price.

## Proposed v1 boundary

| Area | Initial proposal | Decision still required |
| --- | --- | --- |
| Core compute | Reuse enough of the working ESP32-S3 firmware path to reduce the first board's software burden. | Power measurements and component availability before selecting the MCU. |
| LoRa | Start with a supported transceiver and explicit regional RF configurations. | RF matching, antenna, filtering, coexistence, certification path and measured performance. |
| Controls | Prototype a thumb keyboard and a smaller directional-control layout. | Choose using real messaging and packet-navigation tasks, enclosure size and cost. |
| Display | Make packet inspection and short messages readable in the field. | Panel, brightness, power, sunlight and viewing-angle tests. |
| Storage | Local session capture and a dependable USB export path. | Storage medium, write endurance, power-failure behavior and recovery. |
| Connectivity | A useful standalone experience with optional companion software. | Which existing web/native interfaces are reliable enough to ship. |
| Physical design | Original enclosure, accessible charging, antenna arrangement and practical carry size. | Ergonomics, battery safety, assembly, repair and drop tests. |

A single narrowband LoRa receiver does not observe every frequency, spreading factor and incompatible network at once. Tune/scan dwell, dropped traffic and the interruption caused by switching radio profiles must be visible and measured. A second radio is an option to cost after these limitations are observed, not an assumed requirement.

Do not promise a universal spectrum analyzer, simultaneous Meshtastic/MeshCore operation, broadband SDR functions or high-throughput off-grid internet without the necessary architecture and evidence. Expanding to other radio functions can remain a later hardware decision.

## Current firmware evidence

The repository README records live Meshtastic receive/direct-message testing with two T-Decks. MicroSD writes, scan recovery, and live MeshCore/RNode paths still need hardware validation. That is the starting evidence level; screens and parser code alone are not finished product capabilities.

Before freezing a board, exercise long-running reception, sleep/wake, charging while receiving, export integrity, channel changes, message-entry latency and recovery from interrupted writes. Record the exact board, antenna, firmware revision, configuration and observed failures. Choose release thresholds before the next test batch, and publish measured values rather than selecting optimistic targets after the fact.

## Make the margin real

Price is not set. Request quotes for the actual board, enclosure and assembly quantities before treating an existing T-Deck resale calculation as an original-hardware cost.

Contribution per unit = selling price excluding collected sales taxes − components/PCB − assembly and test − enclosure and packaging − inbound freight and duties − payment fees − shipping subsidy − expected returns, warranty and support cost.

Batch cash requirement includes non-recurring engineering, prototypes, tooling, compliance testing, deposits, inventory and a contingency. Break-even units divide fixed costs by **contribution per unit**, not by sale price. All quantities and rates in the first cost model should be quotes or explicitly marked assumptions.

The first paid batch should test whether the product can be delivered and supported at that contribution. It does not need to prove a venture-scale outcome to be a worthwhile profitable hardware business.

## gadgets.sh and the investment thesis

The gallery can create discovery through searchable device pages, comparisons and practical firmware notes. Affiliate revenue and sponsorship are possibilities to validate later, with disclosure. First measure whether visitors return, save devices, read specific wiki entries and seek out our firmware/hardware. The local preview adds no tracking; a production measurement plan is a separate decision.

Shelby remains an optional way to preserve/share captures. Its [upload workflow](https://docs.shelby.xyz/sdks/typescript/node/specifications) uses Aptos commitments. There is no need to invent a second transaction or token to justify the integration. A blockchain receipt also does not itself prove the physical origin or independence of a radio observation.

For Multicoin, distinguish three claims: the wider mesh-network investment thesis; the consumer device's demonstrated demand and economics; and the value of any storage or network service. Evidence for one does not prove the others. A hardware prototype and repeat buyers would strengthen the pitch, while the long-term claims about mesh adoption and throughput still need independent support.

## Next concrete gate

The gallery preview now gives this project a visible home. The next hardware deliverable is a tested interaction prototype and a costed architecture, reviewed against The Hacker Pager. Select the control layout and RF architecture from that evidence, then commission or design the first original PCB and enclosure. Domain acquisition, public launch and taking orders are separate actions that have not happened.
