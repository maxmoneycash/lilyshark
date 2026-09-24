---
id: GR-006
title: Most-wanted cells list
area: growth
size: S
priority: P2
status: done
depends_on:
- PR-005
eval:
  auto:
  - python3 scripts/generate_most_wanted.py --check
  rubric:
  - A generated, dated list of empty/stale cells adjacent to active ones, published where contributors
    look (site + README badge).
  - Regeneration is one command over scorer output.
---

Why: Flightradar24's most-wanted receiver locations page is the cheapest
demand-signal mechanism in the study set.
