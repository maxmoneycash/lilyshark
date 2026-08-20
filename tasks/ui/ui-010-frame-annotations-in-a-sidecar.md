---
id: UI-010
title: Frame annotations in a sidecar
area: ui
size: S
priority: P2
status: todo
eval:
  rubric:
  - Notes attach to frame sequence numbers, stored in a JSON sidecar next to the capture (and inside the
    published bundle), never mutating .lscap bytes.
  - Annotated frames are visible in the table and exports.
---

Why: Field evidence needs field notes ("this is when the interferer started"),
and the capture bytes must stay byte-identical to their commitment. A sidecar
keeps the evidence chain intact.
