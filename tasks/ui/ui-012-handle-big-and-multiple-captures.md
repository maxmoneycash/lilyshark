---
id: UI-012
title: Handle big and multiple captures
area: ui
size: M
priority: P1
status: todo
eval:
  rubric:
  - Frame table is virtualized; a 50k-frame capture scrolls smoothly and the 5,000-frame cap is lifted
    with a documented memory bound.
  - At least two captures can be open in tabs without reload; the live session is one of them.
---

Why: LIVE_CAP=250 and CAPTURE_FRAME_LIMIT=5000 are toy bounds for an overnight
field session, and single-capture-at-a-time blocks the compare workflows
(UI-009) and real analysis sessions.
