---
id: UI-023
title: Dissect Meshtastic telemetry, traceroute, and routing payloads
area: ui
size: M
priority: P1
status: done
depends_on:
- UI-011
eval:
  auto:
  - grep -q "MeshtasticTelemetryFields" webapp/src/lib/dissect/meshtastic.ts
  - '(cd webapp && npm test --silent)'
  rubric:
  - Telemetry payloads (port 67) unpack device metrics (battery %, voltage, channel/air utilization, uptime) and environmental metrics (temp, humidity, pressure).
  - Traceroute payloads (port 70) unpack route discovery hops and per-hop SNR measurements.
  - Routing payloads (port 5) unpack routing error reason codes.
  - Dissection tree nodes mirror exact byte spans, and detail pane displays structured telemetry/traceroute cards.
---

Why: In docs/strategy/2026-q3-direction.md §2, keeping Meshtastic coverage current is
essential as it represents the largest installed mesh base. Previously, when Meshtastic
frames were decrypted in the analyzer (UI-011), ports other than text and position
(telemetry port 67, traceroute port 70, routing port 5) were left as unparsed raw byte blobs,
preventing operators from diagnosing node battery health, channel airtime utilization,
environmental sensors, or traceroute hop paths.

What:
- Structurally dissect Telemetry (port 67), RouteDiscovery (port 70), and Routing (port 5)
  protobuf payloads in `webapp/src/lib/dissect/meshtastic.ts`.
- Extract telemetry device metrics (battery level, voltage, channel utilization, air util tx, uptime)
  and environment metrics (temperature, humidity, barometric pressure).
- Extract traceroute node route arrays and hop SNR measurements.
- Extract routing error reasons.
- Render rich Telemetry and Traceroute cards in `webapp/src/components/TrafficTab.tsx`.
- Comprehensive test fixtures and unit tests in `webapp/src/lib/dissect/dissect.test.ts`.
