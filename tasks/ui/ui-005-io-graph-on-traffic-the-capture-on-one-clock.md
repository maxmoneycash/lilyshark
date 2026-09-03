---
id: UI-005
title: 'IO graph on TRAFFIC: the capture on one clock'
area: ui
size: M
priority: P1
status: done
depends_on:
- UI-003
eval:
  rubric:
  - Packet rate, RSSI/SNR band, and CRC failures plotted over the capture clock, sharing the display filter.
  - Brushing a time range filters the frame table; clearing restores it.
  - Renders 5,000 frames without jank (uPlot is already in the bundle).
---

Why: The firmware has a synchronized Timeline; the analyzer has nothing —
you cannot see a CRC burst or a quiet gap in an opened capture.

What: An IO graph strip on TRAFFIC (uPlot, like TELEMETRY) fed from the
filtered frame set, with time-brush selection linked to the table.
