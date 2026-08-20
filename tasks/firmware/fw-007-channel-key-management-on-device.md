---
id: FW-007
title: Channel key management on device
area: firmware
size: M
priority: P2
status: todo
eval:
  rubric:
  - Channel keys can be entered, named, and deleted on device; stored keys never leave the device and
    are excluded from screenshots and captures.
  - Decoders use stored keys where protocol support exists; key state is visible per decoded frame.
---

Why: Roadmap item; the AES path exists for the default key only. Handling
user keys demands a deliberate security design — hence its own task.
