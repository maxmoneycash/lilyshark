---
id: PA-004
title: Evidence snapshot refresh cadence
area: paper
size: S
priority: P2
status: todo
eval:
  auto:
  - test -f scripts/refresh_evidence.sh
  rubric:
  - One command refreshes the network-evidence fixture and regenerates results_evidence.md with a new
    date stamp; stale snapshots are visibly dated everywhere they are cited.
  - The shelbynet wipe cadence is noted where the evidence numbers are presented.
---

Why: '393k blobs' was true on 2026-08-15 on a chain that gets wiped; dated
evidence stays honest, undated evidence rots into a claim.
