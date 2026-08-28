# Changelog

All notable changes to Lilyshark are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project is
pre-release, so versions are dates, not semver.

## [2026-08-26]

The field session release: two T-Decks exchanging decoded traffic and direct
messages on real hardware, and everything that made that work.

### Fixed
- The radio went permanently deaf after its first transmit: `transmit()`
  cleared the DIO1 interrupt handler and `resumeReceive()` never re-attached
  it. Every device announces itself at boot, so every device went deaf before
  hearing anything. Guarded by a radio integration test that fails on revert.
- The map scale bar printed "200 M" over a bar measuring 8.4 m at z20; it now
  derives a 1-2-5 step from the scale actually on screen.
- Map redraws painted a 65,280-pixel double-precision field chart underneath
  imagery that covered every pixel of it, and loaded eight neighbouring tiles
  before computing that all of them were off screen — the whole of the "map is
  laggy" report.
- The compass arrowhead was silently absent on macOS and present on Linux:
  the chevron guard rejects vectors under one unit, and the compass handed it
  a unit vector whose libm-computed length landed on the comparison itself.
- Chat ran up to 64 AES-128 decryptions per keystroke for one SNR figure that
  lives in RF metadata beside the frame.
- `C` was claimed by chat and silently killed coding-rate tuning; coding rate
  moved to `R`, which then had to stand aside on Traffic Filter, whose reset
  also answers to `R`. The new-message banner named a key (`6`) that opened
  Airtime. Keys are now regression-tested for their documented effect.
- The device-shell suite segfaulted on a fixture-only path (null plot buffer →
  244 LVGL objects for one sparkline) and then failed on ~40 assertion strings
  that had drifted from the reworked UI; the firmware did not link on a clean
  checkout because a generator symbol had no weak fallback. CI is green again,
  and the render stage it had been blocking runs once more.

### Added
- Satellite imagery on-device: hillshade, terrarium contours, and street
  labels, baked for a location or read from a microSD tile pyramid laid on the
  Web Mercator pixel grid (`scripts/build_map_card.py`). Trackball pans the
  map; clicking recentres.
- Chat between devices, with per-peer threads, unread badges, persistence to
  NVS across power cycles, and audible chimes for messages and newly heard
  nodes through the I2S speaker.
- A MESSAGES screen: every decoded text message, newest first, with sender,
  scope, age, and arrival SNR. A finished survey now offers MESSAGES /
  PACKETS / NODES instead of ending on the word COMPLETE.
- Spectrum analysis over the existing 33-bin sweep: peak and noise-floor
  traces, the radio's own channel bracketed on the axis, and a footer with
  peak dBm, its frequency, the floor, and band occupancy.
- LXMF: messages that were never encrypted are read out of Reticulum payloads
  (destination/source hashes, timestamp, title, body, field count), with an
  independent-implementation test vector suite and a 31,855-case fuzz guard.
  Encrypted destinations stay opaque.
- The web analyzer gained browser capture with Shelby publish, and the same
  three basemaps as the device, sharing the field-chart and contour maths.

### Changed
- Every "word + keystroke" button label spelled out; Help rebuilt around the
  keys an operator actually reaches for; GPS states read ON / FINDING / OFF
  everywhere; node lists show range and colour their last-heard age.

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

- The web app is now a terminal-style interface in Lilyshark pink. It
  includes a full MeshCore
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
