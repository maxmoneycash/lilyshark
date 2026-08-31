---
id: UI-007
title: Permalinks to a capture and a frame
area: ui
size: M
priority: P1
status: done
eval:
  rubric:
  - 'A published capture has a stable URL (blob name or commitment) that opens TRAFFIC on it; #frame=N
    selects the frame.'
  - Opening a permalink runs the normal resolve trace — no special cased fetch path.
  - Unpublished local captures show a clear 'publish to get a link' affordance instead of a broken link.
---

Why: The only shareable object today is a manually copied blob name. "Look at
frame 9" — the README's own demo instruction — cannot be a link.

What: Extend the hash routing (#traffic already exists) to carry a capture
reference and frame sequence; PUBLISH surfaces the resulting permalink.
