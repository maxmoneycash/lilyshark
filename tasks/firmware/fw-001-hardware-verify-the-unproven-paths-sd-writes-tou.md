---
id: FW-001
title: 'Hardware-verify the unproven paths: SD writes, touch calibration, scan recovery'
area: firmware
size: L
priority: P0
status: todo
eval:
  rubric:
  - microSD .lscap/pcap/BMP writes verified on a physical T-Deck, files opened on a desktop byte-for-byte.
  - Touch calibration exercised on hardware; spectrum-scan cancellation and receive restoration exercised,
    including SD-removal and CRC-burst cases.
  - A dated field report lands in docs/ recording device revision, firmware hash, and each result — pass
    or fail.
---

Why: The README is explicit that these paths are unverified; they gate the
first tagged release and everything the capture-evidence story rests on.

What: A hardware session working through the README roadmap's validation
items, with the same written-evidence discipline as the first field session.
