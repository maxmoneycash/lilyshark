---
id: UI-016
title: Coverage cell map with most-wanted cells
area: ui
size: M
priority: P2
status: done
depends_on:
- PR-005
eval:
  rubric:
  - Cells colored by observation recency/density from season-scorer output; empty neighboring cells ranked
    as 'most wanted'.
  - Cell resolution is coarse (geohash-5) and the page says why — contributor privacy.
  - Works from the published scorer output file; no private backend state.
---

Why: Hivemapper's gap map is the mechanism that directs effort to where data
is missing; Flightradar24's most-wanted list is the same idea. This turns the
leaderboard into coverage.
