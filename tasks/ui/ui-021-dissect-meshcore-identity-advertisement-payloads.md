---
id: UI-021
title: Dissect MeshCore identity advertisement payloads and node attributes
area: ui
size: M
priority: P1
status: done
depends_on:
- UI-004
eval:
  auto:
  - grep -q "MeshCoreAdvertisementFields" webapp/src/lib/dissect/meshcore.ts
  - '(cd webapp && npm test --silent)'
  rubric:
  - MeshCore advertisement payloads unpack into Ed25519 public key, node ID, timestamp, and signature.
  - App data parses flags, node type (Chat, Repeater, Room, Sensor), location coordinates (lat/lon in degrees), and node name.
  - Tree nodes mirror the exact byte layout and maintain parent-child byte range containment.
  - Addressing extraction in conversation.ts surfaces the advertising node ID as an addressable source.
---

Why: MeshCore is the fastest growing mesh network, and node discovery relies on
signed ADVERT identity frames. Previously, Lilyshark's protocol dissector left
MeshCore advertisement payloads as an unparsed 100-byte raw blob, preventing
operators from inspecting node identity, device type, published GPS positions,
or operator names.

What:
- Structurally dissect MeshCore `Advertisement` (payload type 4) in `webapp/src/lib/dissect/meshcore.ts`.
- Extract 32-byte Ed25519 public key, short node ID, 4-byte monotonic timestamp, and 64-byte Ed25519 signature into discrete tree nodes.
- Dissect the optional app data region: node type (Chat, Repeater, Room, Sensor), position (latitude and longitude in decimal degrees), feature words, and UTF-8 operator name.
- Surface the extracted node identity in `webapp/src/lib/conversation.ts` so MeshCore adverts can be filtered and followed.
- Display the rich advertisement metadata in `webapp/src/components/TrafficTab.tsx`.
