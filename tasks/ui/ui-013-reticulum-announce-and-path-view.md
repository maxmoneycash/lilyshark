---
id: UI-013
title: Reticulum announce and path view
area: ui
size: L
priority: P1
status: todo
depends_on:
- UI-004
eval:
  rubric:
  - Announces decode to destination hash, app name, and hops where present; a per-destination timeline
    shows announce cadence and path changes.
  - Everything shown is derivable from ciphertext-adjacent structure — no claim to read encrypted payloads.
  - A capture with zero Reticulum traffic shows an honest empty state.
---

Why: Reticulum has no analyzer tooling at all (see
docs/strategy/2026-q3-direction.md §1-2) — the FOSDEM community meetup named
observability as an open gap. Announce/link/path dynamics are observable
without keys, and owning this view makes Lilyshark the first Reticulum
analyzer in existence.

What: Semantic layer over the RNode structural dissector: announce parsing,
destination tracking, path-change timeline, per-identity airtime share.
