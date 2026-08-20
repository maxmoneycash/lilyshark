# The premium tier, scoped — feed to unlock

Revenue stream #1 from the [direction memo](2026-q3-direction.md):
lilyshark.com stays a free instrument, the professional conveniences are
paid, and **feeding the network unlocks them for free**. Flightradar24
built the largest sensor network on Earth on this exact trade (feed ADS-B,
get the ~$500/yr Business plan free); WiGLE proved this demographic grinds
for standing alone; MeshCore's £8 T-Deck firmware proved willingness to
pay on our exact hardware. This document draws the line feature by feature
and defines the unlock threshold.

## The line

Free forever — the instrument itself. Charging for these would betray the
register and the GPL posture:

- Live capture over USB/BLE, open/inspect any `.lscap`, hex + dissection,
  display filters, single-capture exports (pcap/CSV/JSON)
- Publish to Shelby and resolve any pointer; the RESOLVE trace
- The demo mesh, DOCS, PAPER, the coverage map's public view
- Leaderboards and season standings — the scoreboard is the growth loop,
  never the product

Premium — the workflows of someone being *paid* to look at RF:

| Feature | What it is | Why it's the paid half |
| --- | --- | --- |
| History | Server-side retention of published captures with search across them (time, cell, protocol, filter expression) | Storage costs real money; hobbyists keep files, professionals need the archive queryable |
| Correlation workspace | Multi-capture open, diff view, witness-pair alignment across devices | The site-survey deliverable: "two sensors, one incident" |
| Alerting | Standing filters over feeds ("CRC storm in cell X", "new node ID on band Y") with webhook/email | Monitoring is an operations budget, not a hobby one |
| API access | Programmatic reads of aggregated coverage/spectrum data (the [Field Receipts](../protocol/field-receipts.md) dataset), rate-limited | This is the data product's retail door |
| Team workspaces | Shared captures, annotations, and alert routing under one org | Teams have procurement; individuals don't need it |

Rule of thumb for future features: if it analyzes *a capture*, it is
free; if it analyzes *your fleet, your archive, or everyone's aggregate*,
it is premium.

## The unlock

**Feeder status: ≥ 10 verified capture-hours in the trailing 30 days ⇒
premium is free that month.**

- A *verified capture-hour* is one hour of non-synthetic capture time,
  published to Shelby and anchored, that passes the season scorer's
  plausibility checks (same machinery as [Season 0](../protocol/season-0.md)
  scoring — no separate entitlement infrastructure).
- Entitlement is computed from **on-chain receipts, not a private
  database**: the anchor events carry publisher, size, and time; the
  scorer output is public. Anyone can recompute who qualifies — the same
  trust model as the points system, and it means the entitlement check
  survives us.
- 10 hours/month is deliberately reachable by one commuter with a T-Deck
  in a bag, and deliberately not reachable by an account that never
  captures. Tune with data, not vibes: revisit after Season 0 with the
  actual distribution of capture-hours.

## Pricing hypothesis

- **Individual: $9/mo or $79/yr.** Anchors: MeshCore's £8 one-off proves
  the community pays at all; FR24 Gold ($4/mo) and Business (~$42/mo)
  bracket the range; our buyer is closer to a WiGLE power user than an
  airline dispatcher. Below $9 the Stripe-fee-to-value ratio embarrasses
  everyone.
- **Team: $49/mo for 5 seats + API.** The EmComm group, the LoRaWAN
  operator debugging a deployment, the vendor's support team.
- **Falsifier:** if after one season fewer than 2% of monthly active
  analyzer users either pay or qualify as feeders, the tier is priced or
  drawn wrong — rescope rather than discount.

## What this must never do

- Gate anything the firmware can do on-device. The T-Deck owes nothing to
  our servers.
- Degrade the free instrument to sell the paid one (no delayed data, no
  nagging, no watermarks).
- Require an account for free-tier use. Accounts appear exactly where
  state must persist server-side.

## Build order (each lands as its own task when scheduled)

1. Accounts + entitlement check against scorer output (needs PR-005).
2. History (retention + search over published captures).
3. Alerting on standing filters (reuses UI-003's filter engine server-side).
4. API over the aggregated dataset (needs enough data to be worth selling).
5. Team workspaces last — sell to individuals first, teams follow usage.
