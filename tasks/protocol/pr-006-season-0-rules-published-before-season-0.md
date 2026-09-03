---
id: PR-006
title: Season 0 rules, published before Season 0
area: protocol
size: S
priority: P1
status: done
depends_on:
- PR-001
eval:
  auto:
  - test -f docs/protocol/season-0.md
  rubric:
  - Point weights, decay curves, cell bonuses, caps, season dates, and what points redeem for this season
    are all stated, with the freeze commitment explicit.
  - The rules acknowledge the whitepaper's verification ladder and say which tier each reward maps to.
---

Why: Frozen-before-start rules are the difference between a season and a
slush fund; the DePIN record (docs/strategy) shows retroactive rule changes
are where communities lose trust.
