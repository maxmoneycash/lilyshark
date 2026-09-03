---
id: UI-001
title: Correct the SHELBY tab's device-payment claim
area: ui
size: S
priority: P0
status: done
eval:
  auto:
  - '! grep -rn "device''s own Aptos account" webapp/src'
  rubric:
  - 'The step-02 copy describes the real upload path: the share service or shelby-put.ts pays, the device
    never holds keys.'
  - No other screen still implies the firmware talks to Aptos directly.
---

Why: The SHELBY tab's step 02 says the blob is "paid for from the device's own
Aptos account." The firmware has no network stack and no signer; uploads flow
through the share service. The project's whole register is honest states —
this is the one place the product currently overclaims.

What: Rewrite the step to describe the actual flow (device writes to SD /
streams over USB; a connected host or the share service pays for the upload;
no keys on the device — which is the design's selling point, say so).

Out of scope: changing the upload flow itself.
