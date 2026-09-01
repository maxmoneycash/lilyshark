---
id: UI-009
title: Diff two captures
area: ui
size: M
priority: P2
status: done
eval:
  rubric:
  - Two captures open side by side with frames matched by payload hash and time offset; unmatched frames
    highlighted per side.
  - 'The witness use-case works: the same transmission heard by two devices lines up, with per-side RSSI/SNR
    shown.'
---

Why: Two T-Decks in the field produce two captures of one RF event; comparing
them is how coverage and witness claims get checked by hand. Also the
debugging tool for decoder regressions between firmware versions.
