---
id: UI-017
title: BLE transport for the Lilyshark device link
area: ui
size: M
priority: P2
status: done
eval:
  rubric:
  - LSK handshake, telemetry, and frame streaming work over Web Bluetooth to a T-Deck without a cable;
    reconnect behavior matches the serial path.
  - Browsers without Web Bluetooth see the existing honest unsupported state.
---

Why: Field use is one-handed and cable-free; BLE already exists for the
MeshCore companion path but not for Lilyshark's own LSK link.
