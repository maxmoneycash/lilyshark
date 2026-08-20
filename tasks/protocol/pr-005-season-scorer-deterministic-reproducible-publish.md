---
id: PR-005
title: 'Season scorer: deterministic, reproducible, published'
area: protocol
size: L
priority: P1
status: todo
depends_on:
- CO-002
eval:
  auto:
  - test -f scripts/field_receipts_score.py
  rubric:
  - Scorer consumes only public inputs (chain events, published blobs) and a pinned rules file; two runs
    on the same inputs are byte-identical.
  - Cell novelty, decay, and per-cell caps implemented per the published Season 0 rules; every constant
    cited to the rules doc.
  - Closed witness cliques (accounts that only witness each other) are down-weighted and the method is
    documented in the output.
---

Why: The trust model of Field Receipts is 'disputes are settled by re-running
the scorer.' That is only true if the scorer exists, is deterministic, and
needs nothing private.
