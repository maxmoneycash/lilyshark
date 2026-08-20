---
id: FW-003
title: Witness-key sidecar on device
area: firmware
size: M
priority: P1
status: todo
depends_on:
- PR-001
eval:
  auto:
  - ls test | grep -q witness
  rubric:
  - Firmware computes witness keys per captured frame (payload hash, rounded frequency, time bucket per
    the frozen spec) and queues them in a sidecar file next to the capture.
  - Implementation matches the golden vector shared with Python and TypeScript.
  - No radio transmission and no network use — the sidecar rides the existing resolve-when-connected pattern.
---

Why: Field Receipts' device half: the T-Deck already holds every input to the
witness key at capture time; computing it there means the phone/analyzer only
submits, never recomputes from the blob.
