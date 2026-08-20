---
id: FW-005
title: Reticulum announce decoder, semantic tier
area: firmware
size: L
priority: P1
status: todo
eval:
  auto:
  - ls test | grep -q reticulum
  rubric:
  - Announce frames decode to destination hash, app name and hop data with sanitizer-clean host tests
    and fixtures shared with the webapp dissector (UI-013).
  - Non-announce Reticulum traffic remains structurally decoded raw bytes — no guessing at ciphertext.
---

Why: Device-side half of owning the Reticulum observability gap; the on-device
Traffic screen should name announces the way it names Meshtastic ports.
