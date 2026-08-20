---
id: PR-002
title: Reference witness-key tooling in Python
area: protocol
size: M
priority: P0
status: todo
depends_on:
- PR-001
eval:
  auto:
  - test -f scripts/field_receipts.py
  - python3 -m pytest test/field_receipts_py -q
  rubric:
  - '`field_receipts.py keys <capture.lscap>` emits witness keys for every eligible frame; synthetic frames
    are refused loudly.'
  - Golden vector asserted; CRC-failed frames excluded per spec.
---

Why: The reference implementation everything else is checked against, same
role scripts/shelby_pointer.py plays for the pointer.
