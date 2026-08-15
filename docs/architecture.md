# Architecture

Lilyshark is two products joined by one capture format: **firmware** that
turns a LILYGO T-Deck into a LoRa traffic and RF analyzer, and a **web app**
that reads its captures back and indexes the Shelby network. The `.lscap`
file is the contract between them.

```
        RF (SX1262)                      microSD / upload
            │                                  ▲
            ▼                                  │
┌─────────────────────────────┐   ┌────────────────────────────┐
│  T-Deck firmware            │   │  Host + cloud              │
│                             │   │                            │
│  radio service → RawFrame   │   │  scripts/lscap.py          │
│        │                    │   │  scripts/shelby_pointer.py │
│        ▼                    │   │  webapp (Vite/React)       │
│  CaptureRuntime             │──▶│    └─ Traffic analyzer     │
│    ├─ DecoderRegistry       │   │    └─ Shelby network views │
│    │   ├─ Meshtastic        │   │  api/[...path] (proxy)     │
│    │   ├─ MeshCore          │   │    └─ services/pulse-api   │
│    │   ├─ Reticulum         │   │         └─ Shelby indexer  │
│    │   └─ Shelby pointer    │   │                            │
│    └─ FrameStore            │   └────────────────────────────┘
│        │                    │
│        ▼                    │
│  views · .lscap · PCAP      │
└─────────────────────────────┘
```

## Firmware (`src/`, `include/lilyshark/`)

The firmware is Arduino/ESP32-S3 on the surface and plain C++17 underneath:
every component that touches data — decoders, the capture runtime, writers,
accumulators — builds and tests on the host with no Arduino dependency, under
AddressSanitizer and UndefinedBehaviorSanitizer.

- **Radio service** (`src/device/radio_service.cpp`) owns the SX1262 and
  produces `RawFrame` values: the captured bytes plus every RF measurement the
  radio can prove — frequency, bandwidth, spreading factor, coding rate, RSSI,
  SNR, CRC state, frequency error, airtime.
- **Capture runtime** (`include/lilyshark/core/capture_runtime.h`) ingests each
  frame: the decoder registry tries decoders in registration order and stops
  at the first match, then the frame store keeps the ring of recent frames
  that backs the on-device views. No allocation, no exceptions.
- **Decoders** (`src/core/`, `src/shelby/`) — Meshtastic, MeshCore, and
  Reticulum each add only the meaning they can prove from the frame; anything
  unknown or encrypted stays available as raw bytes. The Shelby pointer
  decoder is registered last: it only claims frames no protocol decoder
  recognized, so it surfaces an off-grid pointer without claiming to own the
  enclosing protocol (see `docs/shelby-pointer-format.md`).
- **Exports** (`src/export/`) write the same frames as native `.lscap`
  (`docs/lilyshark-capture-format.md`) and as standards-compatible PCAP/
  LoRaTap when the active PHY profile fits that format's limits.
- **Views** — nine on-device screens: live traffic, packet detail, nodes,
  spectrum (from the SX1262 histogram), a 60-second field survey, airtime
  utilization, events, plus the product shell and settings.
- **Simulator** (`src/sim_main.cpp`, `-e simulator`) runs the full UI against
  SDL on the host, including a framebuffer-exact render test and a scripted
  demo tour (`scripts/run_ui_demo.sh`).

## Host tooling (`scripts/`)

Python 3, standard library only, tested the same way as the firmware
(`python3 -m unittest discover` inside `scripts/test_all.sh`).

- `lscap.py` — validate and dump `.lscap` captures as JSON.
- `shelby_pointer.py` — reference tooling for the Shelby off-grid pointer:
  emit, parse, scan a capture, and verify a blob against a pointer's
  commitment, size, and expiry. See `docs/shelby-off-grid.md`.
- `generate_sample_capture.py` — writes the deterministic demo capture in
  `samples/`.
- `test_all.sh` — every host test (C++ under sanitizers, Python suites), the
  simulator build and render test, the t-deck firmware build, and factory
  image validation. CI (`.github/workflows/build.yml`) runs exactly this.

## Web app (`webapp/`)

Vite + React, deployed on Vercel. The interface is a terminal-style app
ported from meshcore-terminal (MIT) and recolored Lilyshark pink; see
`webapp/README.md` for the full map.

- **TRÁFICO** (`src/mesh/screens/Traffic.tsx`) opens `.lscap` captures —
  from disk, from the bundled sample, or fetched from Shelby by blob name —
  and presents them Wireshark-style: frame list, decoded RF metadata, hex
  dump, capture statistics, and inline decoding of Shelby off-grid pointers.
- **Mesh client screens** (CHAT, NODOS, MAPA, MALLA, TELEMETRÍA, CONFIG,
  DEBUG) drive a real radio over Web Serial or BLE — nothing routes through
  a server.
- **SHELBY** reads the network itself — blobs, storage, providers, and the
  ShelbyUSD economy — served by `services/pulse-api`, a small indexer/API
  service that syncs the chain's `blobs` and `blob_activities` tables.

## Cross-language wire formats

Two formats are shared across languages and are therefore pinned by golden
test vectors, so all implementations accept exactly the same bytes:

| Format | Spec | Implementations |
| --- | --- | --- |
| `.lscap` capture | `docs/lilyshark-capture-format.md` | C++ writer, Python reader, TypeScript reader |
| `SHLB` pointer (82 B) | `docs/shelby-pointer-format.md` | C++ encoder/decoder, TypeScript reader, Python codec |
