---
id: UI-015
title: Leaderboard panel from chain events
area: ui
size: M
priority: P1
status: todo
depends_on:
- CO-002
eval:
  rubric:
  - Season leaderboard renders from field_points events (indexer GraphQL) with anchor/witness breakdown
    per account.
  - Data source and its limits are labeled (which chain, which season rules).
  - Dead indexer degrades to a dimmed panel like the SHELBY screen does — never a fake zero.
---

Why: WiGLE ran two decades on rank alone; the scoreboard is the cheapest
gamification surface we can ship and the first thing a Season 0 competitor
looks at.
