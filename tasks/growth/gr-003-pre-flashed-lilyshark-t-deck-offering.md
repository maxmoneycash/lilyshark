---
id: GR-003
title: Pre-flashed Lilyshark T-Deck offering
area: growth
size: M
priority: P1
status: doing
depends_on:
- FW-001
eval:
  auto:
  - test -f docs/strategy/hardware-offering.md
  rubric:
  - Flash-and-QA checklist per unit (radio RX check, display, SD write) derived from the preflight script.
  - Margin model with LILYGO unit cost, labor, and shipping; break-even units stated.
  - 'GPL compliance stated: buyer gets the exact source ref for the flashed build.'
---

Why: Revenue stream #2 and the acquisition funnel; MeshCore's paid firmware
proves willingness-to-pay on this exact device, and we sell the open version
with hardware.
