---
id: UI-003
title: Display filter language on TRAFFIC
area: ui
size: L
priority: P0
status: done
eval:
  auto:
  - test -f webapp/src/lib/frameFilter.ts
  - cd webapp && node --import tsx --test src/lib/frameFilter.test.ts
  rubric:
  - Grammar covers proto, freq, sf, cr, rssi, snr, crc, len, dir, has:pointer, has:synthetic with ==,
    !=, <, >, &&, ||, parentheses.
  - Bad input shows an inline error at the offending token; the table never silently shows wrong results.
  - Filter state round-trips through the URL hash so a filtered view is shareable.
  - Stat strip recomputes over the filtered set and says it is filtered.
---

Why: The web TRAFFIC table has no filtering at all — the single most basic
Wireshark capability. The firmware has a Traffic Filter screen; the analyzer,
which handles 5,000-frame captures, has none.

What: A typed filter expression parsed to a predicate over decoded frame
fields, evaluated client-side, with unit tests for the grammar and
precedence. Keep the syntax close to Wireshark display filters where fields
overlap.

Out of scope: capture (BPF-style) filtering on the device.
