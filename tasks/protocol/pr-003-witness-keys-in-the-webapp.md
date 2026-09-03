---
id: PR-003
title: Witness keys in the webapp
area: protocol
size: M
priority: P0
status: done
depends_on:
- PR-001
eval:
  auto:
  - cd webapp && node --import tsx --test src/lib/witnessKey.test.ts
  rubric:
  - Same golden vector as PR-002; keys computed from opened captures via WebCrypto.
  - Synthetic provenance blocks key computation in the library, not just the UI.
---

Why: The analyzer is the first attestation surface (UI-014); it needs the key
math in the browser, vectored against the reference.
