---
id: UI-010
title: Frame annotations in a sidecar
area: ui
size: S
priority: P2
status: done
eval:
  rubric:
  - Notes attach to frame sequence numbers, stored in a JSON sidecar next to the capture (and inside the
    published bundle), never mutating .lscap bytes.
  - Annotated frames are visible in the table and exports.
---

Deviation, recorded: the rubric asked for notes to travel 'inside the
published bundle'. The publish path uploads a single .lscap blob and
anchors its commitment — there is no bundle to put a sidecar in, and
inventing one would change the publish/anchor flow. The sidecar instead
records the capture's commitment when it has one, binding the two
without altering either. Revisit if publishing ever grows a container.

Why: Field evidence needs field notes ("this is when the interferer started"),
and the capture bytes must stay byte-identical to their commitment. A sidecar
keeps the evidence chain intact.
