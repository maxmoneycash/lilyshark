---
id: PA-005
title: State the MERIDIAN gap
area: paper
size: L
priority: P2
status: todo
depends_on:
- PA-001
eval:
  rubric:
  - A short doc (or paper addendum) says which parts of the paper's §19–20 protocol spec this repo will
    and will not build, and why Field Receipts is the part that got built first.
  - If GNSS-interference observation is ever in scope, it enters the board as tasks; if not, the paper's
    recommendation is marked as addressed-to-investors, not a product commitment.
---

Why: The paper specifies a full token protocol the repo doesn't contain; a
reader who expects §19 on-chain finds a 95-line registry. The gap is fine —
unstated, it looks like vaporware.
