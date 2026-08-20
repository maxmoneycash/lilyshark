---
id: UI-014
title: Witness corroboration in TRAFFIC
area: ui
size: M
priority: P1
status: todo
depends_on:
- PR-003
- CO-002
eval:
  rubric:
  - Each frame shows its witness state (unwitnessed / attested by you / corroborated xN) fetched from
    field_points events.
  - An ATTEST action submits witness keys for selected frames through the share service; the trace shows
    the tx.
  - Synthetic frames can never be attested — enforced in the UI and the service.
---

Why: The Field Receipts loop needs its first surface: see a frame, attest it,
watch corroboration arrive when a second device uploads. TRAFFIC is where
that story is legible frame by frame.
