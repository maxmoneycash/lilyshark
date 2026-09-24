---
id: GR-007
title: Announce Reticulum analyzer support where Reticulum lives
area: growth
size: S
priority: P2
status: done
depends_on:
- UI-013
eval:
  auto:
  - grep -qi 'zulip' docs/strategy/reticulum-announcement.md
  - grep -qi 'r/reticulum' docs/strategy/reticulum-announcement.md
  - grep -qi 'hackaday' docs/strategy/reticulum-announcement.md
  rubric:
  - Posts drafted for the post-Qvist community venues (Zulip, r/reticulum, Hackaday tip line) showing
    real announce decoding on real captures — instrument register, no marketing voice.
  - Feedback routed back into the board as tasks.
---

Why: First-mover credit in an explicitly named gap only lands if the
community that named the gap sees it working.
