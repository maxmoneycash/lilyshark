---
id: UI-020
title: Reticulum announce path-change graph visualization
area: ui
size: M
priority: P1
status: done
depends_on:
- UI-013
eval:
  auto:
  - grep -q "buildTransitionGraph" webapp/src/lib/announceGraph.ts
  - grep -q "AnnouncePathGraph" webapp/src/components/AnnouncePathGraph.tsx
  - '(cd webapp && node --import tsx --test "src/lib/announceGraph.test.ts")'
  rubric:
  - Computes path transition events (hop count shifts, direct vs transport shifts, delta timestamps) across consecutive announces.
  - Aggregates directed transition edges with counts and hop deltas.
  - Generates valid Mermaid flowchart syntax representing the topology shifts.
  - Interactive UI allows selecting destinations, filtering frames, viewing chronological shift history, and copying Mermaid code.
  - Detail inspector provides quick access to path graph when inspecting an announce frame.
---

Why: In Reticulum mesh networks, nodes dynamically move between direct RF links
and multi-hop transport instances as connectivity shifts. Previously, Lilyshark
only tracked isolated path snapshots without showing how paths migrated over time.
Visualizing path transitions gives operators instant insight into mesh route stability,
flapping transports, and hop inflation.

What:
- Implement `buildTransitionGraph` in `webapp/src/lib/announceGraph.ts` with node hop tracking, directed transition edges, and Mermaid diagram generation.
- Build `AnnouncePathGraph` component in `webapp/src/components/AnnouncePathGraph.tsx` providing destination selection, quick filtering, directed edge summaries, chronological transition logs, and Mermaid code export.
- Integrate into `TrafficTab.tsx` with a `PATHS` toolbar action and a direct `PATH GRAPH` inspector button on announce frames.
