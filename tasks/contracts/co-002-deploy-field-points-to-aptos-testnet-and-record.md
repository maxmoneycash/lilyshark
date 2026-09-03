---
id: CO-002
title: Deploy field_points to Aptos testnet and record it
area: contracts
size: S
priority: P0
status: blocked
depends_on:
- CO-001
eval:
  rubric:
  - Module published to Aptos testnet (durable, unlike weekly-wiped shelbynet) under a documented account;
    addresses and txs recorded in the contract README.
  - attest_witness and claim_anchor_points exercised once on-chain with the txs linked.
---

Why: shelbynet is wiped roughly weekly — a scoreboard that resets itself is
not a scoreboard. Blobs stay on Shelby; the durable score lives on Aptos
testnet until mainnet is worth the gas.
