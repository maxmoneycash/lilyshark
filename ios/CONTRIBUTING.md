# Contributing to PommeCore

Thanks for your interest in contributing! PommeCore is a companion app for MeshCore LoRa mesh radios, built with SwiftUI.

## Getting Started

1. Fork the repo and clone your fork
2. Open `PommeCore.xcodeproj` in Xcode 16+
3. Build targets: iOS, macOS, or watchOS
4. No external dependencies — everything is in the MeshCoreKit Swift package

## Testing Hardware

Most features require a physical MeshCore radio (Heltec Mesh Pocket, Heltec V3, etc.) connected via Bluetooth. UI-only changes can be tested without hardware.

## Before Submitting a PR

- Run `./scripts/test_build.sh` — must pass with zero errors and zero warnings
- Keep changes focused — one feature or fix per PR
- Follow existing code style and architecture patterns
- Test with persisted data, not just fresh installs

## Architecture Notes

- Views use `@Environment(Store.self)` — not `@EnvironmentObject`
- Protocol types (`MeshCoreProtocol`, `MeshCoreCommand`, etc.) live in the MeshCoreKit package
- App coordination goes through `PommeCoreViewModel` — stores are wired via closures
- All `@Published` setters must run on `@MainActor`

## What We're Looking For

See the open issues for current priorities. General areas:
- Bug fixes with clear reproduction steps
- Accessibility improvements (Dynamic Type, VoiceOver)
- Performance improvements with measurable impact

## What We Won't Merge

- Changes to bundle IDs, signing, or distribution scripts
- Features that require internet connectivity (PommeCore is offline-first)
- Dependencies on third-party packages

## License

By contributing, you agree that your contributions will be licensed under the GPL-3.0 license.
