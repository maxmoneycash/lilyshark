---
id: GR-005
title: Season 0 capture competition kit
area: growth
size: M
priority: P1
status: done
depends_on:
- PR-006
- PR-005
eval:
  auto:
  - test -f docs/strategy/season-0-event.md
  rubric:
  - Event format (WiGLE/DEF CON wireless-village style) with entry rules, scoring tied to the published
    Season 0 rules, and prizes that cost access or hardware, not tokens.
  - Legal note on capture legality by region included — we run listening competitions, not transmitting
    ones.
---

Note: originally depended on UI-015 (leaderboard panel). Running an event
needs the frozen rules and the scorer, not a rendered panel — standings
publish as scorer JSON. Dependency corrected to PR-005/PR-006; UI-015
remains the nicer live display.

Why: Revenue stream #5 and the community ignition mechanism; WiGLE proves
this demographic grinds leaderboards at events for decades.
