---
id: UI-019
title: Dissect MessagePack in Reticulum announce app_data
area: ui
size: M
priority: P1
status: done
depends_on:
- UI-013
eval:
  auto:
  - grep -q "dissectMsgpack" webapp/src/lib/dissect/rnode.ts
  - '(cd webapp && npm test --silent)'
  rubric:
  - Valid MessagePack in Reticulum announce app_data expands to structural key/value or element nodes in the dissection tree with exact byte ranges.
  - Recognizes standard NomadNet / Sideband / LXMF announce fields (e.g. display name, node type) without crashing or claiming crypto verification.
  - Non-MessagePack or corrupted app_data falls back gracefully to raw bytes preview.
---

Why: In Reticulum applications (NomadNet, Sideband, LXMF), destination announces
routinely carry application metadata packed with MessagePack in `app_data`.
Until now, the dissector reported this as undecoded raw bytes. Giving operators
structural visibility into node names, software versions, and custom announce fields
completes the announce inspection experience promised in GR-007.

What: Implement MessagePack dissection for announce `app_data` in
`webapp/src/lib/dissect/rnode.ts` using the bounded `Reader` from `lxmf.ts`.
Extract maps, arrays, strings, and numbers into clickable dissection tree nodes
with exact byte spans, and add test fixtures covering NomadNet and Sideband announces.

Out of scope: Verifying application cryptographic signatures over `app_data`
(the dissector is passive and keyless).
