---
id: PR-007
title: Sybil-clique analysis over the witness graph
area: protocol
size: M
priority: P2
status: todo
depends_on:
- PR-005
eval:
  rubric:
  - A notebook/script over attestation events surfaces witness cliques, degree distributions, and timing
    anomalies, run against Season 0 data.
  - Findings feed a written recommendation for Season 1 rule changes.
---

Why: v0's threat model prices sybils rather than preventing them; this is the
measurement that tells us the price was right — the paper's own
adversarial-behaviour-under-payment section applied to our data.
