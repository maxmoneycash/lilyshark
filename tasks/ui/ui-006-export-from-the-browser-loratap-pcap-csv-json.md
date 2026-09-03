---
id: UI-006
title: 'Export from the browser: LoRaTap pcap, CSV, JSON'
area: ui
size: M
priority: P1
status: done
eval:
  auto:
  - cd webapp && node --import tsx --test src/lib/export/*.test.ts
  rubric:
  - Exported pcap opens in Wireshark with DLT-270 radio headers intact (verify against a firmware-written
    pcap of the same capture).
  - CSV/JSON carry the decoded columns currently on screen, respecting the active filter.
  - Synthetic frames are marked in every export format — provenance survives the round trip.
---

Why: The analyzer can only re-download .lscap. Every interoperability path —
Wireshark, pandas, spreadsheets — is closed. The firmware already defines the
LoRaTap mapping; the browser should speak it too.

What: Client-side exporters mirroring src/export/, unit-tested against the
existing golden fixtures.
