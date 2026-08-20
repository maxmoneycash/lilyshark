---
id: UI-008
title: Follow conversation
area: ui
size: M
priority: P2
status: todo
depends_on:
- UI-004
eval:
  rubric:
  - From a decoded frame, one action filters the table to the same src/dst pair (where the protocol exposes
    them) ordered on the capture clock.
  - Frames whose addressing cannot be decoded are excluded explicitly, not silently.
---

Why: Wireshark's follow-stream is the analyzer gesture; once dissection
(UI-004) exposes addressing, grouping by conversation is cheap and high value
for multi-node debugging.
