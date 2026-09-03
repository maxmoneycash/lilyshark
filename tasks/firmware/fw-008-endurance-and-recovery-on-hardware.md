---
id: FW-008
title: Endurance and recovery on hardware
area: firmware
size: L
priority: P1
status: todo
depends_on:
- FW-001
eval:
  rubric:
  - An overnight capture + spectrum session on hardware completes with no lockup, no SD corruption, and
    a plottable diagnostics log.
  - Radio-recovery, missing-peripheral, and battery-sag behavior recorded in the field report.
---

Why: The remaining roadmap gate between developer alpha and a tagged release
someone else can trust in the field.
