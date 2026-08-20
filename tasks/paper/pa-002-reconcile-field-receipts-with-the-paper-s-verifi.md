---
id: PA-002
title: Reconcile Field Receipts with the paper's verification ladder
area: paper
size: M
priority: P1
status: done
depends_on:
- PR-001
eval:
  auto:
  - grep -qi 'verification ladder\|observation tier' docs/protocol/field-receipts.md
  rubric:
  - The protocol doc cites the paper's tier framework and argues, honestly, why witness attestation is
    observation-tier evidence rather than the coverage-tier incentives the paper declines.
  - Any point where Field Receipts contradicts the paper is stated as a disagreement, not papered over.
---

Why: The paper recommends against incentive layers on managed-flood routing;
Field Receipts rewards corroborated observation, not routing. That argument
is currently implicit and should be in the spec, because reviewers who read
the paper will ask.
