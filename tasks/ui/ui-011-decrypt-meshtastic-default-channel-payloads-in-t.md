---
id: UI-011
title: Decrypt Meshtastic default-channel payloads in the browser
area: ui
size: M
priority: P1
status: todo
depends_on:
- UI-004
eval:
  auto:
  - cd webapp && pnpm vitest run --reporter=basic src/lib/dissect/meshtasticCrypto.test.ts
  rubric:
  - Frames under the published default key decrypt and dissect in the browser, matching the firmware decoder's
    output on the same fixtures.
  - Decrypted state is labeled with which key was used; unknown-key frames stay honest ciphertext.
  - User-supplied channel keys enter through the UI, live only in memory, and are never persisted or uploaded.
---

Why: The firmware already reads default-key Meshtastic messages
(src/crypto/aes128.cpp); the analyzer shows the same frames as opaque hex.
Parity here is table stakes for "the same instrument on a bigger screen."

What: WebCrypto AES-128-CTR mirroring the firmware nonce construction,
golden-vectored against the C++ tests.
