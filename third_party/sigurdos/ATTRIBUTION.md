# Third-party: SigurdOS

The code in this directory is from **SigurdOS**
(https://github.com/hermes-gadget/SigurdOS-tdeck), Copyright (C) 2025 Ben,
licensed **GPL-3.0-or-later** — see `LICENSE` in this directory and the
SPDX headers preserved on every file. Imported at upstream commit
`ce59f0f` (release `beta-0.1.47-RC9`, 2026-08-02).

Lilyshark is GPL-3.0, so this incorporation is license-compatible. Per
GPL §5(a), files modified for Lilyshark carry a "Modified for Lilyshark"
notice below their original header; unmodified files are verbatim.

## What was taken, and why

| Subtree | Lines | Why |
| --- | --- | --- |
| `comms/` | ~5,400 | The MeshCore **companion bridge** (BLE + USB CDC + WebSocket/TCP transports). Adapting this lets a T-Deck running Lilyshark speak the companion protocol the Lilyshark web analyzer already uses (`@liamcottle/meshcore.js`), so the device and the webapp connect directly. |
| `hal/` (subset) | ~5,500 | Field-hardened drivers for the exact same board: I2C keyboard + layouts, trackball debounce, GT911 touch, shared-SPI arbitration (display vs microSD — the precise contention our README warns about), battery curve, prefs with atomic writes, boot watchdog, sleep orchestration. Reference and port material for our device layer. |
| `mesh/path_codec` | ~450 | Companion-bridge dependency. |

## What was deliberately NOT taken

- Their 16.7k-line MeshCore client stack — for protocol behavior we go to
  upstream MeshCore (MIT) directly rather than inheriting a divergent fork.
- All UI (`ui/`, `app/`, fonts, i18n) — Lilyshark's instrument shell is its
  identity; theirs is a messenger's.
- OTA/web-flasher infrastructure — planned separately.

## Integration rules

1. Never edit these files in place for feature work — port into
   `src/`/`include/lilyshark/` behind our interfaces, keeping the SPDX
   header plus a provenance line on any file that carries copied code.
2. The firmware build does not compile this directory; it is a vendored
   reference until the companion-bridge port lands.
3. Keep this import pinned; refresh deliberately, never automatically.
