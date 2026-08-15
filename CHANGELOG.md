# Changelog

All notable changes to Lilyshark are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project is
pre-release, so versions are dates, not semver.

## [2026-08-15]

### Added — firmware

- Shelby off-grid pointer (`SHLB`): an 82-byte record carrying a blob
  commitment, owner account, size, expiry, and chunk position. It fits one
  LoRa payload and rides inside Meshtastic, MeshCore, and Reticulum frames
  as an application payload convention, so stock nodes relay it untouched.
- `ShelbyPointerDecoder` finds pointers at any offset inside an enclosing
  protocol's payload and rejects inconsistent chunk state, so part of a
  split blob can never pass for a whole one.

### Added — host and cloud

- Web app: Wireshark-style `.lscap` analyzer (frame list, RF metadata, hex
  dump, statistics) with capture fetch by Shelby blob name, plus live
  Shelby network views — blobs, storage, providers, and the ShelbyUSD
  economy.
- The Traffic tab marks frames carrying a Shelby pointer and decodes the
  pointer inline.
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
