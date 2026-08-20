---
id: CO-001
title: Compile and unit-test field_points
area: contracts
size: M
priority: P0
status: done
eval:
  auto:
  - '! command -v aptos >/dev/null 2>&1 || (cd contracts/field-points && aptos move test --named-addresses lilyshark=0xA11CE)'
  rubric:
  - 'Tests cover: pair corroboration pays both; duplicate attester aborts; late attesters decay to zero
    past MAX; window expiry pays nothing; anchor claims pay the delta exactly once; 31-byte keys abort.'
  - Constants (weights, window, caps) match docs/protocol/field-receipts.md, or the doc is updated in
    the same change.
  - Module compiles against the same framework rev as capture-registry.
---

Why: contracts/field-points/sources/field_points.move landed as a draft
written without the Aptos CLI available; it must not be called deployed, or
even correct, until `aptos move test` says so.

What: Install the CLI, compile, write the test module, fix what the compiler
and prover-of-record (the test suite) find.
