# Changelog

All notable changes to Lilyshark are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project is
pre-release, so versions are dates, not semver.

## [2026-08-15]

### Added — web app, rebuilt as a terminal

- The web app is now a terminal-style interface ported from
  meshcore-terminal (MIT; UI itself ported from perereus/meshtastic-terminal),
  recolored Lilyshark pink by a one-line theme. It includes a full MeshCore
  client — chat, nodes, map, mesh graph, telemetry, config, and a debug log —
  driving a real radio over Web Serial or BLE; nothing routes through a
  server.
- The `.lscap` analyzer is the TRÁFICO screen: open from disk, from the
  bundled sample, or from Shelby by blob name; readouts, frame table with
  the SHLB marker, RF detail, hex dump, and an inline Shelby-pointer decode.
- The SHELBY screen indexes the live network, WHITEPAPER embeds the
  document, and the whole terminal speaks Spanish and English.
- The ported test suites (theme, i18n, mesh, alerts, battery, fmt) run in
  `npm test` alongside the lscap suite.

### Added — firmware

- Shelby off-grid pointer (`SHLB`): an 82-byte record carrying a blob
  commitment, owner account, size, expiry, and chunk position. It fits one
  LoRa payload and rides inside Meshtastic, MeshCore, and Reticulum frames
  as an application payload convention, so stock nodes relay it untouched.
- `ShelbyPointerDecoder` finds pointers at any offset inside an enclosing
  protocol's payload and rejects inconsistent chunk state, so part of a
  split blob can never pass for a whole one.

### Added — host and cloud

- `scripts/shelby_pointer.py`: reference tooling for the connected side —
  emit, parse, scan captures, and verify blobs against pointers.
- `samples/sample-mesh-traffic.lscap`: a deterministic 24-frame demo
  capture with a pointer at sequence 9; no radio required.
- Documentation: architecture, the off-grid design, both wire-format specs,
  a reviewer quickstart, flashing guide, contributing and security notes.

### Verified

- Both wire formats (`.lscap`, `SHLB`) are pinned by golden test vectors
  across C++, TypeScript, and Python — all implementations accept exactly
  the same bytes.
- C++ suites run under AddressSanitizer and UndefinedBehaviorSanitizer via
  `scripts/test_all.sh`; CI runs the same script on every push.

## Earlier

The alpha series brought up the T-Deck hardware: display initialization and
runtime evidence, live UI input, diagnostics hardening, and the first
flashed-device checks. See the git history for the full trail.
