---
id: GR-008
title: Field Ranks progression layer over Field Receipts points
area: growth
size: M
priority: P1
status: doing
depends_on:
- GR-002
- UI-015
eval:
  auto:
  - test -f docs/protocol/field-ranks.md
  - test -f webapp/src/lib/fieldRanks.ts
  - test -f webapp/src/lib/fieldRanks.test.ts
  - cd webapp && node --import tsx --test "src/lib/fieldRanks.test.ts"
  rubric:
  - XP is exactly Field Receipts points recomputed from the frozen weights in field_points.move / season-0-rules.json,
    not a second invented currency, and RANK-VECTOR-1 pins the mapping like WITNESS-VECTOR-1 pins the witness key.
  - Ranks, badges, and operator class are non-transferable, mint nothing, reward no transmission, and are
    a pure function of public on-chain events — recomputable by anyone, same trust model as the scorer.
  - The WatchDogsGo inspiration is named and its offense economics (hat gradient, XP for attacks) are explicitly
    rejected in favor of the listening-only, no-token posture.
---

Why: WiGLE ran two decades on rank alone and MeshCore's £8 firmware proved
this community pays for standing on this exact hardware; the direction memo
(§4) and Season 0 both bet on gamified recognition as the growth loop, but
"badges" and "rank" were only ever gestured at, never specified. WatchDogsGo
(LOCOSP/WatchDogsGo) is the working proof that an XP/rank/badge overlay makes
invisible RF fieldwork legible and addictive. This task borrows that mechanic
and drops its offense economics: XP *is* the Field Receipts score, so the
progression layer adds engagement without adding a single new incentive to
keep honest.

What: A deterministic progression engine (`webapp/src/lib/fieldRanks.ts`) that
maps an account's credited point events to XP, a twelve-rank ladder, milestone
badges tied to real events, and a no-judgment operator class — golden-vectored
(RANK-VECTOR-1) and unit-tested. A spec (`docs/protocol/field-ranks.md`) in the
repo's honest register that names the inspiration, states the mapping, and
reconciles it with the listening-only / non-transferable / no-token ethos.

Out of scope: wiring a rank card or leaderboard screen into the live analyzer
(that is a follow-up UI task on top of UI-015's event reader); any change to
`field_points` weights or the season rules; anything that mints, transfers, or
converts a rank.
