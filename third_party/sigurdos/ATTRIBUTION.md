# Third-party: SigurdOS

Everything in this directory is **SigurdOS**, not Lilyshark.

- **Upstream:** https://github.com/hermes-gadget/SigurdOS-tdeck
- **Copyright:** (C) 2025 Ben (GitHub `hermes-gadget`), with contributions
  from `n30nex`, `gadgethd`, `Jah-yee`
- **License:** GPL-3.0-or-later — full text in `LICENSE` beside this file
- **Imported at:** commit `ce59f0f`, release `beta-0.1.47-RC9` (2026-08-02)
- **Modifications by Lilyshark:** none. This is a verbatim import.

Lilyshark is also GPL-3.0, which is what makes this incorporation
license-compatible. The obligation that comes with it is simple and we keep
it: the copyright notices and the license stay attached, and any file we
later modify will say so in place, per GPL §5(a).

Most source files carry their own `SPDX-License-Identifier: GPL-3.0-or-later`
header. A small number of upstream files do not; those are covered by the
repository-level `LICENSE` here, exactly as they are upstream. We have not
added, altered, or removed any copyright or license notice.

## Why it is here

SigurdOS is the most complete MeshCore *client* firmware for the LilyGo
T-Deck — messaging, contacts, rooms, BLE/USB companion bridging, offline
maps, and a hardened HAL for this exact board, validated across 30 build
environments and ~1,600 host tests.

Lilyshark is a different thing: a packet sniffer and RF analyzer that
captures frames with their radio physics, writes `.lscap` and LoRaTap PCAP,
and anchors captures in Shelby content-addressed storage. The two are
complementary rather than competing — vendoring their client gives Lilyshark
a proven messaging and companion-bridge foundation to build the analyzer on
top of, instead of reimplementing a mesh client from scratch.

## What we are building on it

Highest value first:

1. **Companion bridge** (`src/comms/`) — speaks the MeshCore companion
   protocol over USB CDC, BLE, and WebSocket. This is the protocol the
   Lilyshark web analyzer already speaks via `@liamcottle/meshcore.js`, so
   porting it means lilyshark.com connects directly to a Lilyshark device.
2. **HAL** (`src/hal/`) — keyboard, trackball, GT911 touch, battery curve,
   shared-SPI arbitration between display and microSD, sleep orchestration,
   atomic preference writes. Field-hardened on the same silicon.
3. **Mesh client** (`src/mesh/`) — MeshCore protocol, stores, persistence.
4. **Diagnostics** (`src/diagnostics/`) — logging, telemetry, crash capture.

## Ground rules

- Do not edit files in this directory for Lilyshark feature work. Port into
  `src/` and `include/lilyshark/` behind our own interfaces, carrying the
  SPDX header and a provenance line onto any file that contains copied code.
- The Lilyshark firmware build does not compile this directory. It is a
  pinned reference and porting source until integration lands.
- Refresh deliberately by re-importing a named upstream commit and updating
  the header of this file. Never merge upstream silently.

## Upstream's own request

The SigurdOS maintainer declines donations and asks that support go to
MeshCore instead (https://meshcore.co.uk). Lilyshark passes that request
along rather than quietly benefiting from it.
