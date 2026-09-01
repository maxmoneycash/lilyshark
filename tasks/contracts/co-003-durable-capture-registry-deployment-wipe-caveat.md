---
id: CO-003
title: Durable capture_registry deployment + wipe caveat
area: contracts
size: S
priority: P1
status: doing
depends_on:
- CO-001
eval:
  auto:
  - grep -qi 'wiped' contracts/capture-registry/README.md
  rubric:
  - capture_registry deployed alongside field_points on Aptos testnet so claim_anchor_points has a durable
    registry to read.
  - README documents the shelbynet wipe cadence and labels the shelbynet deployment as demo-scoped.
  - The webapp's anchor reads point at the durable deployment (or clearly label which chain they show).
---

Why: The existing shelbynet deployment — and the anchors in it — evaporate on
each wipe. The docs currently present it without that caveat.
