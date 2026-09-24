---
id: UI-022
title: MeshCore network health and repeater topology overview
area: ui
size: M
priority: P1
status: done
depends_on:
- UI-021
eval:
  auto:
  - grep -q "MeshCoreOverview" webapp/src/lib/meshcoreView.ts
  - '(cd webapp && npm test --silent)'
  rubric:
  - Aggregates MeshCore node identities, roles (Chat, Repeater, Room, Sensor), positions, and cadence from advertisement frames.
  - Computes network health metrics: infrastructure vs client ratio, hop count distributions, route type mix, and active repeater relay utilization.
  - Renders an interactive MeshCore network health panel in the webapp with node directory, hop distribution, and repeater topology graph with Mermaid export.
  - Provides honest empty states when no MeshCore frames or no advertisements are present in the capture.
---

Why: As highlighted in docs/strategy/2026-q3-direction.md §2, MeshCore is the fastest-growing
mesh protocol, and its repeater/room topology is designed for health monitoring that closed
apps do not provide. Following the structural dissection of MeshCore advertisement payloads
in UI-021, Lilyshark now has the primitives to serve as the premier open network health
and diagnostic tool for MeshCore meshes.

What:
- Build `webapp/src/lib/meshcoreView.ts` to aggregate MeshCore frames across a capture:
  node identity directory, role breakdown (Repeater, Room, Sensor, Chat), geographic
  coordinates with geohash encoding, advertisement cadence, hop count distributions,
  route types (Flood vs Direct vs Transport), payload mixes, and repeater hop utilization.
- Generate directed repeater traversal topology with Mermaid syntax export.
- Create `webapp/src/components/MeshCoreHealthPanel.tsx` presenting the overview metrics,
  node directory with one-click filtering (`src == <nodeId>`), hop histogram, and topology map.
- Integrate the panel into `webapp/src/components/TrafficTab.tsx` with a toolbar action
  and a direct trigger from the detail pane's MeshCore advertisement card.
- Provide comprehensive unit tests in `webapp/src/lib/meshcoreView.test.ts`.
