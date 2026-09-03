---
id: CO-004
title: 'Registry v2: dedupe, pagination, self-serve anchoring'
area: contracts
size: M
priority: P1
status: todo
depends_on:
- CO-002
eval:
  rubric:
  - Duplicate commitments per publisher are rejected or explicitly versioned; views support ranged reads
    so the webapp stops downloading whole registries.
  - A user path exists to anchor under their own account from the analyzer (wallet-signed), alongside
    the share-service path.
  - Migration/compat with v1 data is stated, even if the answer is 'none, v1 is demo'.
---

Why: v1 is an append-only vouch log with whole-vector reads — right for a
demo, wrong for a registry the points system pays against.
