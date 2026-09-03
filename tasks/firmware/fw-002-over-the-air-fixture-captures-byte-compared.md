---
id: FW-002
title: Over-the-air fixture captures, byte-compared
area: firmware
size: M
priority: P0
status: todo
depends_on:
- FW-001
eval:
  rubric:
  - Known Meshtastic, MeshCore, and RNode transmissions captured OTA on a T-Deck and compared byte-for-byte
    with desktop-SDR captures of the same transmissions.
  - Fixtures (or their hashes, where airtime law limits publishing) land in test/ and pin the decoders.
---

Why: Every decoder is fixture-tested against synthetic bytes; the claim that
the device hears what was actually sent needs OTA ground truth once.
