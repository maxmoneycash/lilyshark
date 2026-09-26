# Lilyshark product and growth decisions — 2026-09-26

This is a working plan based on the current repository, branch history, and
published competitor documentation. It is a set of tests to run, not a claim of
customer demand. No physical T-Deck was available for this pass. Earlier
two-device Meshtastic observations and remaining hardware gaps are recorded in
the [README](../../README.md#project-status). No customer interviews, paid
pilots, or hands-on competitor comparisons were completed here.

## The first user and the job

Start with a **community repeater maintainer** who is deciding whether a
location, antenna, or radio configuration improved a link. A second useful
group is a firmware developer who needs to reproduce an emitted packet or
timing defect. Both already have a radio and existing software. Their test is
whether Lilyshark gets them from a real incident to a defensible next action
faster than their current tools.

The proposed promise is: **compare what two receivers actually recorded,
keep the raw evidence, and state what remains unknown.** The web TRAFFIC
comparison now has two explicit modes. Same Event aligns captures that share
multiple distinct received packets, leaves them unpaired when their boot clocks
cannot be aligned, and excludes TX, unknown-direction, and generated records
from witness matching. Separate
Visits summarizes each file's received frames, reported RF settings, and
signal samples without pairing transmissions or claiming an improvement.
These are a starting point, not yet a complete site survey report.

The everyday MeshCore and Meshtastic message and node loop still matters.
The [MeshCore direction](meshcore-app-direction-2026-09-14.md) documents
remaining radio ACK, retry, background, and iPhone analyzer transport checks.
A diagnostic feature cannot compensate for a messaging path users cannot
trust.

## What the market already supplies

| Existing tool | Published capability | Decision for Lilyshark |
| --- | --- | --- |
| [MeshMapper wardriving app](https://wiki.meshmapper.net/app_getting_started/) | MeshCore BLE, GPS sessions, mobile and Chromium clients | Do not build a generic second MeshCore wardriving app as the initial pitch. |
| [MeshMapper modes](https://wiki.meshmapper.net/app_wardriving_modes/) | Manual, hybrid, active, passive RX plus discovery requests, trace, and smart ping deferral | “Passive mode,” low-airtime surveys, and targeted traces are already served. Note that its Passive mode still sends discovery requests. |
| [MeshMapper leaderboards](https://wiki.meshmapper.net/leaderboards/) | First-explorer and airtime-saver credit | Points for new cells or restraint are not unique acquisition mechanics. |
| [MeshMapper FAQ](https://wiki.meshmapper.net/faq/) | Regional operation and a prohibition on unauthorized scraping or undocumented API access | Use only an authorized documented regional coverage grant; the current Lilyshark [coverage adapter](../coverage-map.md) has no such live credential here. |
| [Meshtastic link planner](https://github.com/meshtastic/meshtastic_linkplanner) | Terrain-based coverage prediction | Distinguish a predicted path from measured reception. |
| [MeshCore Rx Log converter](https://github.com/aaronb/wireshark-meshcore) | Export and Wireshark inspection of MeshCore observations | Packet trees and export are a baseline; make the full decision workflow better. |

These are source-described features, not results of a same-radio usability
study. The earlier [market analysis](lora-sniffing-market-analysis-2026-09.md)
also lists MeshMonitor, CoreScope, MeshSense, and CatSniffer. Its strongest
caution remains: public-channel decoding alone is a weak reason to buy another
device or subscription.

## The field workflow to build

1. **Prepare.** Record protocol, PHY settings, antenna, firmware revision,
   location source, and observation window. Display that one SX1262 hears
   only its selected profile and that a spectrum sweep pauses reception.
2. **Observe.** Keep raw frames, missing RF fields, CRC status, timing, and
   synthetic provenance. Never convert a missing reading to 0 dB.
3. **Compare.** For simultaneous receivers, require agreeing distinct
   packets before aligning clocks. List shared and receiver-only frames,
   signal differences with sample counts, and the alignment evidence. For a
   sequential antenna/site change, compare separately collected windows
   without claiming they contain the same transmission.
4. **Explain.** Separate observed fact (“receiver A recorded this packet”),
   protocol interpretation (“header names node X”), and hypothesis (“the
   antenna placement may explain the difference”). A capture cannot prove a
   remote hop failed or calculate delivery percentage without known test
   transmissions and the appropriate receiving endpoint.
5. **Hand off.** Export a small report with capture hashes, settings,
   provenance, uncertain fields, and links back to frames. Keep source files
   local unless a user explicitly chooses to share. A hash proves byte
   consistency against the hash, not authentic radio origin.

The first shippable report should answer one narrow question: **did two
receivers at named sites hear the same planned test, and what did each measure?**
Use controlled, permissioned test traffic and a known transmission count for
delivery claims. Avoid gathering message contents just to make a coverage
graphic.

## Find users and test the purchase

Use the [sample capture quickstart](../quickstart.md) to make the interface
evaluable with no hardware. Pair it with one annotated example report that
shows the reasoning and its limits. Once a deck passes the storage and scan
checks, invite five repeater maintainers, four firmware developers or vendors,
and three field or event operators to bring a **recent real incident**. These
are recruiting targets, not a market estimate.

For each participant, record their existing device/app and free tools, the
question they were trying to answer, time to a correct conclusion, setup
friction, misleading states, and whether an independent observation confirmed
the conclusion. Give them Lilyshark for the same task under comparable radio
conditions. Ask them to use it for a second real task without prompting and,
where appropriate, request a priced pilot or hardware commitment. Avoid
hypothetical “would you pay?” answers.

Recruit through maintainers' existing technical communities with a useful
case study and exact radio/capture evidence. The
[Reticulum announcement draft](reticulum-announcement.md) is a candidate
only after live RNode samples exist; its present “works over Web Bluetooth”
and first-mover claims need correction before posting. The separate
[gadgets.sh project](gadgets-sh-and-custom-hardware.md) can carry a
source-checked Lilyshark-on-T-Deck guide and refer people to the free
quickstart. Measure visits that open a capture and complete a real task,
repeat use, and qualified requests for a device or survey. Signups and
leaderboard entries alone are not proof of demand. No outreach or purchase
was made as part of this plan.

A proposed continuation gate from the market analysis: at least five people
reuse the product voluntarily for a second task, three independent buyers
make a paid commitment at a price that covers actual delivery costs, and the
benefit is visible against their existing workflow. These thresholds are
management choices. If they fail, narrow the workflow or retain an
enthusiast/education product rather than assuming a subscription.

## Hardware and release sequence

| Order | Gate | Evidence needed |
| --- | --- | --- |
| 1 | Capture integrity | Physical microSD write, remove/reinsert, open the card-produced .lscap and PCAP, and compare bytes. |
| 2 | Radio recovery | Scan, cancel, profile switch, CRC burst, and long reception; demonstrate that receive resumes. |
| 3 | Input and power | Calibrate touch and battery against references; test charging, wake, and interrupted writes. |
| 4 | Transport | Exercise Meshtastic phone BLE and LSK analyzer BLE discovery, subscription, fragmentation, reconnect, and power cost on a real deck. The latter remains disabled in the browser. |
| 5 | Other protocols | Capture a known MeshCore transmitter and an RNode implementation over the air, then compare with desktop records. |
| 6 | Offer | Tag a verified firmware release and cost a supportable batch before taking device orders. The [hardware offering](hardware-offering.md) has a per-unit checklist; its price figures are placeholders. |

Host builds and simulator tests can close software defects tonight. They do
not close these physical gates.

## Wardriving and contribution scope

A Lilyshark field session should first be a **local, evidence-backed site
check**, with deliberate opt-in export. MeshMapper already provides a public
MeshCore coverage map, active and passive wardriving, offline upload, and
airtime-aware points. Lilyshark should use its documented aggregate coverage
API only after obtaining an authorized regional credential, label it as an
external source, and keep it apart from the connected receiver's observations.
Do not synthesize routes, individual ping history, or contributor uploads from
aggregate cells.

The checked-in [Most-Wanted list](../most-wanted.md) is generated from
synthetic fixtures in a future example week. It is now marked as sample in
both Markdown and JSON. It must not steer a real event or hardware giveaway.
A live list needs authenticated inputs, provenance, update time, regional
permission, and a review of whether the cell data exposes a person's route.

## Points, Shelby, and a commercial offer

The [Season 0 rules](../protocol/season-0.md) define non-transferable points
with no monetary value. The witness graph method demonstrates blind spots in
synthetic populations and does not prove independent radio reception. A
capture commitment attests to bytes, not location, receiver control, or
truthful measurement. The scorer and proposed rewards should remain research
instruments until real observations and an abuse review exist.

Shelby's [current network page](https://docs.shelby.xyz/protocol/architecture/networks)
describes only a developer prototype that can be wiped roughly weekly. Its
[token-economics page](https://docs.shelby.xyz/protocol/architecture/token-economics)
now describes a native-token design but says full tokenomics and initial
distribution will be published later. These pages do not grant Lilyshark
holders a Shelby reward, a conversion rate, or a storage business. Do not sell
points or promise later conversion. The [premium tier](premium-tier.md)
prices and “feed 10 capture-hours to unlock” rule are hypotheses, not an
implemented entitlement or measured purchase behavior.

Because Season 0 is dated to start October 1, publish a readiness decision
**before that date**: if verified physical capture, durable rules deployment,
authentic live inputs, privacy review, and an operated scorer are absent,
postpone the public competition or explicitly run a labeled simulation.
Do not publish fixture-derived leaderboards as active coverage. Token work
should wait for a buyer who wants a validated data service and an economic
reason that ordinary payments and credits cannot serve.

## Branch decisions

The older `origin/claude/shelby-token-protocol-gamify-coxmrc` branch contains
the Field Receipts, scorer, witness, BLE, and analyzer work that was selectively
salvaged into `main`. Its market and token assumptions precede the September
market review and Shelby's newer high-level token document. The divergent
simulation, flash-page, T-Deck intro, and BLE worktree branches carry useful
implementation ideas, but no branch was merged wholesale: current `main`
already contains later capability and provenance fixes. Review any remaining
commit against current tests and product evidence before cherry-picking it.

Next software slice: an exportable capture report with source-file commitments
and frame links, followed by a fixture-backed walk-through that teaches the
two comparison modes. Next field slice: the physical gate above, then the
first maintainer study.
