---
id: FW-011
title: Reticulum IFAC packet handling and filter flags
area: firmware
size: S
priority: P2
status: done
eval:
  auto:
  - (cd webapp && node --import tsx --test "src/lib/frameFilter.test.ts")
  - (cd webapp && node --import tsx --test "src/lib/conversation.test.ts")
  - grep -q "rns.ifac" webapp/src/lib/frameFilter.ts
  - grep -q "isReticulumIfac" webapp/src/lib/dissect/rnode.ts
  rubric:
  - Explicit UI badge and filter expression (rns.ifac == 1 or rns.ifac or has:ifac) for IFAC-masked frames.
  - Clearly conveys why inner headers cannot be read without interface access keys.
  - Reticulum IFAC packets are recognized across table, filter, and detail views without crashing or misidentifying destination.
---

Why: Reticulum networks commonly employ Interface Access Codes (IFAC) to protect
interfaces against unauthorized traffic or to isolate subnets. Without explicit IFAC
indicators and display filters, an operator cannot tell whether an encrypted or
unreadable packet is corrupt or IFAC-protected.
