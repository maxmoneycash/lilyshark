---
id: PR-001
title: Freeze the witness-key derivation and its test vector
area: protocol
size: S
priority: P0
status: todo
eval:
  auto:
  - grep -q 'WITNESS-VECTOR-1' docs/protocol/field-receipts.md
  rubric:
  - The spec fixes byte order, rounding, and bucket edges with no residual ambiguity — two implementers
    reading it independently produce identical bytes.
  - A byte-exact golden vector (inputs and key) is published in the spec, pointer-format style.
  - Boundary behavior (frame straddling a time bucket) is specified, including the accepted-loss rationale.
---

Why: Three implementations (Python, TypeScript, C++) will compute this key;
the repo's rule is wire formats get frozen specs and golden vectors before
the second implementation exists.

What: A normative section in docs/protocol/field-receipts.md with the vector,
mirroring how docs/shelby-pointer-format.md pins the pointer.
