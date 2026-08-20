---
id: UI-002
title: 'Anchor on publish: browser publishes must register on-chain'
area: ui
size: M
priority: P0
status: doing
eval:
  auto:
  - grep -rn 'capture_registry' webapp/api webapp/services | grep -qi register
  rubric:
  - A capture published from TRAFFIC resolves with a green ANCHOR step immediately afterwards.
  - The share service signs the registry transaction server-side; no key reaches the browser.
  - Publish still succeeds (with a visible 'not anchored' state) if the chain write fails.
---

Why: PUBLISH TO SHELBY uploads the blob but never calls
`capture_registry::register`, so a freshly published capture shows "no
on-chain anchor" in its own RESOLVE trace. The product demos its one
evidence-chain feature failing.

What: After a verified upload, the share service registers the capture
(commitment, blob name, size, expiry) under its account and returns the tx
hash; TRAFFIC shows the anchor in the trace and links the explorer.

Out of scope: letting users anchor under their own accounts (CO-004 territory).
