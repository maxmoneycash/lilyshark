# Season 0 rules

Season 0 of [Field Receipts](field-receipts.md) runs **2026-10-01 through
2026-12-31** (calendar Q4 2026, UTC; a season is a calendar quarter). These
rules are announced now and **frozen at season start: this document is the
freeze.** Nothing in it changes retroactively during the season. If an
error is found mid-season, it is documented here as an erratum and fixed in
Season 1's rules — the DePIN record
([strategy memo §3](../strategy/2026-q3-direction.md)) is clear that
retroactive rule changes are where communities lose trust, so we accept a
flawed-but-stable quarter over a corrected-but-moving one.

Values below marked **Season 0 parameter** are placeholders chosen
conservatively for a first season with no usage data; they are frozen for
this season and expected to change in Season 1 based on what Season 0
measures.
The machine-readable freeze of every parameter below is [season-0-rules.json](season-0-rules.json), the file the scorer (`scripts/field_receipts_score.py --rules`) pins by hash in its output.

## What counts, and what it pays

### On-chain points (fixed in the `field_points` module)

These weights are constants in the
[`field_points` module](../../contracts/field-points/sources/field_points.move)
and are enforced on-chain, not by this document:

| Action | Points | Condition |
| --- | ---: | --- |
| Witness corroboration | 25 each | To both the first and second distinct account attesting the same witness key, when the second lands within the 7-day attestation window |
| Late witness | 5 | Attesters in positions 3–8 of an already-corroborated key, inside the window |
| Beyond position 8, or outside the window | 0 | Recorded (corroboration count is useful data) but not credited |
| Anchor claim | 10 | Per capture anchored in `capture_registry`, claimed via `claim_anchor_points` |

The module is a draft not yet deployed to durable rails (CO-004). If the
deployed constants differ from the table above at season start, this
document is corrected and re-frozen before 2026-10-01; after that date the
deployed module is the authority and this table must match it.

### Cell scoring (computed by the published scorer)

A **cell** is geohash-5 (~5 km) × band × ISO week. Cell scoring needs GPS
context from inside capture blobs, so it is computed off-chain by the
Season 0 scorer (`scripts/field_receipts_score.py`, task PR-005) — a
deterministic script over public chain events and public blobs. Disputes
are settled by re-running it.

| Rule | Value | Status |
| --- | ---: | --- |
| First-verified-capture-in-cell bonus | 8 points | **Season 0 parameter** — frozen at season start; this document is the freeze |
| Re-survey decay | floor(8 / 2^k), where k = number of earlier ISO weeks this season with a verified capture in the same geohash-5 × band (8, 4, 2, 1, then 0) | **Season 0 parameter** — frozen at season start; this document is the freeze |
| Per-cell weekly cap | one cell credit per cell per ISO week — the first verified capture in the scorer's deterministic event order takes it, so a cell contributes at most 8 points per week | **Season 0 parameter** — frozen at season start; this document is the freeze |

"Verified" means the capture is anchored on-chain and its blob resolves
and matches its commitment at scoring time.

### Closed witness cliques are down-weighted

Sybil pairs that only ever witness each other are the priced-not-eliminated
attack in the [threat model](field-receipts.md#threat-model-honestly). For
season standings, the scorer applies a discount:

| Rule | Value | Status |
| --- | ---: | --- |
| Clique test applies after | 10 corroborations by the account | **Season 0 parameter** — frozen at season start; this document is the freeze |
| Partner-concentration threshold | ≥ 80% of an account's corroborations with the same set of ≤ 3 partners | **Season 0 parameter** — frozen at season start; this document is the freeze |
| Discount applied to that account's witness points in standings | × 0.25 | **Season 0 parameter** — frozen at season start; this document is the freeze |

The mechanism is implemented and documented in the scorer (PR-005); the
measurement of how well the threshold performed — degree distributions,
timing anomalies, cliques it caught and missed — is task PR-007, run
against Season 0 data and feeding Season 1's rules. On-chain point totals
are never modified; the discount exists only in season standings.

## What Season 0 points redeem for

- **Rank** — the Season 0 leaderboard, permanent.
- **Named credit** — per-cell "first surveyed by" attribution on the
  coverage map.
- **Early access** — premium analyzer features free for Season 0
  contributors when those features exist (they are scoped, not shipped;
  see the [strategy memo §4](../strategy/2026-q3-direction.md)).

**Explicitly: no tokens, and no monetary value.** Points are
non-transferable on-chain, there is no Lilyshark token, and none is
promised — the sequencing argument is the
[strategy memo §3](../strategy/2026-q3-direction.md): points now,
conversion only if and when there is real value to distribute. Anyone
selling Season 0 points is selling nothing.

## Where each reward sits on the verification ladder

The whitepaper's ladder (§3) ranks what an external party can check a
contribution against: coverage (self-certified) < delivery (counterparty
receipt) < observation (checked against physics/independent parties).
Season 0's weights follow it:

- **Witness corroboration (25) — observation tier.** Two independently
  operated receivers reporting the same frame bytes is the strongest
  evidence this protocol can produce, so it earns the most.
- **Anchor points (10) — the evidence floor.** An anchor proves bytes were
  committed and paid for (Shelby storage + gas), which prices spam but
  proves nothing about where or how they were heard. Steady, low,
  unbounded in count.
- **Cell bonuses (8, decaying to 0, capped) — coverage tier, deliberately
  weighted lowest.** A "first in cell" claim is closest to the coverage
  claims the paper is most skeptical of (§4: proof of location has no
  general solution; GPS spoofing is the flagged weakest point of Field
  Receipts v0). It requires an anchored, resolvable capture and is
  cross-checked against other receipts from the cell, but it is still the
  least verifiable reward here — so it carries the smallest weight, decays
  fastest, and is the only one with a hard cap.

## Timeline

| Date | Event |
| --- | --- |
| Before 2026-10-01 | Rules published (this document); scorer published (PR-005); freeze announced |
| 2026-10-01 00:00 UTC | Season 0 opens; rules frozen |
| 2026-12-31 23:59 UTC | Season 0 closes (event timestamps on-chain decide inclusion) |
| January 2027 | Final scorer run published with inputs pinned; PR-007 clique analysis; Season 1 rules drafted from both |
