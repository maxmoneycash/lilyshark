# Changelog

All notable changes to Lilyshark are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project is
pre-release, so versions are dates, not semver.

## [2026-08-15]

### Added — complete T-Deck product shell

- The first visible application frame is the antialiased Lily Pink wordmark.
  Six first-run stages explain the tools, select the mesh family and radio
  profile, teach the controls, report actual hardware readiness, and persist
  completion only after a verified settings write.
- Home and Settings now route to radio profiles, capture and storage controls,
  device status, display and input controls, Help, About, guarded spectrum
  ownership, and guarded setup reset.
- Thirteen analyzer and tool routes now cover Traffic, composable filters,
  rolling Protocols and Protocol Detail, fast/deep Spectrum, Nodes and Node
  Detail, a five-tab Packet Inspector, local GPS, Survey, Airtime, Timeline,
  and a scrollable semantic Events history.
- The simulator now drives those screens with one deterministic moving RF
  stream. Exact 320x240 tests cover 13 analyzer routes, 17 shell routes, and
  eight Packet/Event substates; a separate motion gate checks each live data
  region. An 87-step state-aware tour records the complete UI in a dedicated
  macOS window, and the README gallery/GIF are generated from the same frames.

### Changed — device truth and recovery

- App-setting, profile, capture, and reset writes expose failures and restore
  the prior runtime state instead of reporting success. Capture sessions can
  stop, restart, unmount, remount, and recover from writer or flush failures.
- Packet Detail retains capture-time RF metadata and every raw byte, with
  protocol-specific facts supplied by the real decoders. Protocol filters do
  not alter either capture file.
- GPS restarts discard stale parser state, input polling survives `millis()`
  rollover, and the device UI distinguishes unavailable, disabled, degraded,
  unsupported, and recording states.

### Added — web app, rebuilt as a terminal

- The web app is now a terminal-style interface descending from
  perereus/meshtastic-terminal (MIT), recolored Lilyshark pink by a one-line
  theme. It includes a full MeshCore
  client — chat, nodes, map, mesh graph, telemetry, config, and a debug log —
  driving a real radio over Web Serial or BLE; nothing routes through a
  server.
- The `.lscap` analyzer is the TRAFFIC screen: open from disk, from the
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
runtime evidence, live UI input, diagnostics hardening, and the first-device
smoke-test harness. See the git history for the full trail.
