---
id: FW-004
title: Finish LSK TX for MeshCore
area: firmware
size: M
priority: P1
status: done
eval:
  auto:
  - '! grep -rn ''identity-pending'' src/sim_main.cpp'
  rubric:
  - Sending on a MeshCore channel from the analyzer transmits from the device with a real identity, mirroring
    the Meshtastic TX path.
  - Failure states (no identity, radio busy) surface as explicit LSK errors, not silence.
---

Why: `LSK TX meshcore` is a stub returning identity-pending — the analyzer
offers a send box that cannot send on the fastest-growing mesh.
