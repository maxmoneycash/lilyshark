# Field Ranks — the progression layer over Field Receipts

Lilyshark already turns field work into an on-chain number: anchor a capture,
corroborate a transmission, survey an empty cell, and
[Field Receipts](field-receipts.md) credits your account. What it does not do
is make that number *feel* like anything. Field Ranks is the presentation
layer that does — XP, a rank ladder, badges, and an operator class — so the
scoreboard reads like progress instead of a ledger.

This borrows a working idea, openly, and then throws out its economics.

## The thing we are copying, and the thing we are not

[LOCOSP/WatchDogsGo](https://github.com/LOCOSP/WatchDogsGo) is an open-world
"hacking RPG" that overlays a retro operator UI onto real WiFi/BLE fieldwork
on an ESP32-C5. Walking around earns XP; XP earns ranks (NOOB → FINAL_BOSS
across twenty levels); milestones earn badges (FLIPPER, HS_HUNTER, EVIL_TWIN);
and an activity ratio sorts the player onto a white→black "hat" gradient. It
is a genuinely good piece of design: it makes invisible RF work legible and
rewarding, which is exactly the trick WiGLE has used to keep people wardriving
for twenty years on rank alone (the [direction memo](../strategy/2026-q3-direction.md)
§4 and [Season 0](season-0.md) both lean on that same WiGLE precedent).

We copy the **legibility mechanic** — XP, ranks, badges, a class — and reject
the **economics underneath it**, because ours is a different instrument:

| WatchDogsGo | Field Ranks | Why |
| --- | --- | --- |
| XP for offensive actions (deauth, evil-twin credential capture, WPA3 DoS) | XP only for **listening**: corroboration, anchoring, survey | Lilyshark never transmits to score — [Season 0](season-0.md)'s one rule |
| XP is its own invented currency | **XP is exactly your Field Receipts points** | No second economy to keep honest; nothing new is minted |
| Hat color grades how offensive you are (white → black) | Operator **class** names *which listening work* you do, with no moral axis | There is no offense here to grade |
| Ranks to FINAL_BOSS at 10,000,000 XP | Twelve ranks topping out around one steady season of work | Points are real and hard-won, not idle-clicker inflation |
| Scores sync to a community server (`wdgwars.pl`) | Ranks are a pure function of **public on-chain events** | The [scorer](../../scripts/field_receipts_score.py) trust model: anyone can recompute |

The one-line summary: **Field Ranks is a lens on the points, not a new pot of
them.** Delete this layer and the protocol is unchanged; every incentive still
lives in `field_points` and the season rules.

## XP is points — the exact mapping

There is no XP table to maintain separately, on purpose. XP is the sum of an
account's credited Field Receipts points, recomputed from the frozen weights
in [`field_points`](../../contracts/field-points/sources/field_points.move)
and [`season-0-rules.json`](season-0-rules.json) — never read from an emitted
`amount`, the same discipline the [scorer](../../scripts/field_receipts_score.py)
uses:

| Contribution | Weight | Tier |
| --- | ---: | --- |
| Witness corroboration (attester 1 or 2, in window) | 25 | observation |
| Late witness (positions 3–8) | 5 | observation |
| Anchor claim (capture registered) | 10 | evidence floor |
| First-verified-capture-in-cell | 8, decaying `floor(8/2^k)` | coverage |

The on-chain part is recomputed from event counts; the coverage part is the
number the off-chain scorer already produces (cell decay is per-week-per-cell
state the scorer owns, so the engine takes it as an input rather than
guessing). WatchDogsGo's "smart XP" — full points for a new device, 1 XP for a
duplicate — falls out of this for free: our late-witness decay (25 → 5 → 0) and
re-survey decay (8 → 4 → 2 → 1 → 0) are the same anti-farming shape, and they
are already frozen in the season rules.

The reference implementation is `webapp/src/lib/fieldRanks.ts`, pure and
deterministic (no clock, no network, no storage), pinned by a golden vector
`RANK-VECTOR-1` the way [`WITNESS-VECTOR-1`](field-receipts.md#test-vector-witness-vector-1)
pins the witness key. Any change to a weight, a threshold, or a badge trigger
must re-freeze that vector, so a silent drift in the economics fails CI.

## The rank ladder

Twelve ranks, listening-flavored — no `SCRIPT_KIDDIE`, no `EXPLOIT_DEV`,
because this is an instrument, not a break-in kit. Thresholds are a roughly
geometric curve: the first rank lands on a single corroborated frame, and the
top is a full quarter of steady field work, not an idle-clicker's 10,000,000.

| Tier | Rank | XP | Earned by |
| ---: | --- | ---: | --- |
| 0 | UNLICENSED | 0 | Nothing yet. The air is still noise. |
| 1 | LISTENER | 25 | One corroborated frame, or a capture on chain. |
| 2 | SCANNER | 75 | Sweeping bands, anchoring captures. |
| 3 | WARDRIVER | 200 | Moving and mapping — WiGLE's oldest rank. |
| 4 | SURVEYOR | 450 | Filling cells the map had blank. |
| 5 | WITNESS | 900 | Your receptions keep corroborating others. |
| 6 | PATHFINDER | 1,600 | First into empty cells, repeatedly. |
| 7 | ELMER | 2,800 | The ham's word for the one who brings others on the air. |
| 8 | NETRUNNER | 4,500 | Reading the whole mesh at once. |
| 9 | OPERATOR | 7,000 | A standing presence in the receipts. |
| 10 | SIGINT | 10,000 | Signals intelligence at hobby scale, all published. |
| 11 | MERIDIAN | 15,000 | The observation network the paper wanted (§19–20). |

These are **Season 0 parameters**: frozen for the season, tuned in Season 1
against the real distribution of capture-hours, never changed mid-season — the
same freeze discipline as every other number in [season-0.md](season-0.md).

## Badges

Each badge marks a real Field Receipts event, the same way WatchDogsGo's
badges each mark a first real action:

- **FIRST LIGHT** — first capture anchored on chain.
- **CORROBORATED** — first transmission a second receiver confirmed with you.
- **PATHFINDER** — first verified capture from a previously empty cell.
- **CARTOGRAPHER** — verified captures in 10 distinct cells.
- **QUORUM** — 25 corroborations; a reliable second witness.
- **ARCHIVIST** — 100 captures anchored.
- **SEASON VETERAN** — points earned across two or more seasons.
- **CLEAN HANDS** — real field work, and never a synthetic frame submitted.

`CLEAN HANDS` is the one badge with no WatchDogsGo analog. Submitting synthetic
frames as field data is the single disqualifying offense in
[Season 0](season-0.md) and the one thing the firmware, analyzer, and tooling
all refuse for witness keys; rewarding its absence makes the protocol's one
hard rule visible on the card.

## Operator class — the honest hat

WatchDogsGo's hat color is a moral gradient. Field Ranks has nothing to
moralize — every operator only ever listens — so the class instead names
*which* listening work dominates an account's XP, and carries no judgment:

- **RECRUIT** — no verified work on the board yet.
- **WITNESS** — corroboration-led; your receipts confirm others'.
- **SURVEYOR** — coverage-led; you fill blank cells.
- **ARCHIVIST** — anchor-led; you keep the evidence floor stocked.
- **FIELD OP** — balanced, when no single column owns more than 55% of XP.

Ties resolve toward the higher verification tier (witness > survey > anchor),
mirroring the ladder the whitepaper and Field Receipts already rank rewards by.

## Where this sits — and the one rule it must never break

Field Ranks changes **no on-chain state and mints nothing.** It reads
`field_points` events and scorer output and renders them; it never writes.
That keeps the whole [token question](field-receipts.md#4-points-seasons-and-the-token-question)
answered the way the direction memo answers it — points now, conversion only
if and when there is real value to distribute:

- **No token, no transfer.** Ranks and badges are non-transferable because the
  points behind them are. A rank cannot be bought, sold, or gifted.
- **No new airtime.** Everything scored is something the mesh already carried;
  nothing here rewards transmitting, per Field Receipts §"No routing rewards".
- **Recomputable by anyone.** Because XP is a pure function of public events,
  a disputed rank is settled by re-running the engine — the same trust model
  as the scorer. Ranks survive us.

The redemption loop is unchanged from
[Season 0](season-0.md#what-season-0-points-redeem-for): rank, named credit,
and early access. Field Ranks just makes the rank worth looking at.
