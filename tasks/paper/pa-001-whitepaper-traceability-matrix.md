---
id: PA-001
title: Whitepaper traceability matrix
area: paper
size: M
priority: P0
status: done
eval:
  auto:
  - test -f docs/whitepaper-traceability.md
  rubric:
  - Every load-bearing claim mapped to implementation/evidence in the repo, or explicitly marked not-built/diverged.
  - The MERIDIAN §19 spec's relationship to Field Receipts stated plainly — what we adopt (genesis gate,
    observation tier), what we don't (GNSS network, token).
---

Why: 'Relate what we have to our whitepaper' — the paper is a research report
whose recommendations the repo only partially embodies; the gap needed a
map before it becomes marketing debt.

Done in this change: docs/whitepaper-traceability.md.
