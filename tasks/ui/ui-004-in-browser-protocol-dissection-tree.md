---
id: UI-004
title: In-browser protocol dissection tree
area: ui
size: L
priority: P1
status: todo
eval:
  auto:
  - test -d webapp/src/lib/dissect
  - cd webapp && pnpm vitest run --reporter=basic src/lib/dissect
  rubric:
  - Meshtastic, MeshCore, and RNode structural fields shown as an expandable tree above the hex dump,
    with byte-range highlight on hover.
  - TypeScript dissectors are golden-vectored against the same fixtures as the C++ decoders in test/ —
    same bytes, same fields.
  - Undecodable payloads say so explicitly and stay available as raw bytes.
---

Why: All three protocol decoders live only in firmware C++; the browser shows
RF metadata and hex. A Wireshark-class analyzer needs the dissection tree
where the analysis actually happens — the big screen.

What: Port the structural decoders to TypeScript under webapp/src/lib/dissect,
share the fixture corpus with test/, and render the tree in the frame detail
pane with hex highlighting.

Out of scope: payload decryption (UI-011), semantic Reticulum announces (UI-013).
