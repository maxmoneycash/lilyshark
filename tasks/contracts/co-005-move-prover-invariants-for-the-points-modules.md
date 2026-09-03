---
id: CO-005
title: Move Prover invariants for the points modules
area: contracts
size: M
priority: P2
status: done
depends_on:
- CO-001
eval:
  rubric:
  - 'Prover specs cover: points never decrease; anchors_claimed never exceeds registry count; an attester
    appears at most once per key; credited amounts match the constant schedule.'
  - CI (or a documented command) runs the prover; failures block changes to the modules.
---

Why: The whitepaper's own protocol spec (§19) demands prover invariants for
anything that keeps score; ours should meet the bar the paper sets for
others.
