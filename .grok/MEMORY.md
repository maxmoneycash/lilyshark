# Project Environment

Inspected 2026-09-07 by argent-environment-inspector.

- **Type:** monorepo — ESP32-S3/LVGL firmware (PlatformIO), native SwiftUI iOS/macOS/watchOS companion (`ios/PommeCore.xcodeproj`), Vite+React web analyzer (`webapp/`). Not React Native.
- **iOS:** scheme `PommeCore`, bundle id `com.lilyshark.app`, display name Lilyshark. Simulator product: `ios/DerivedData/Build/Products/Debug-iphonesimulator/PommeCore.app`. Launch with Argent `launch-app`, do not tap the home-screen icon.
- **Build:** `./scripts/build_ios.sh` (unsigned simulator). macOS: `xcodebuild -project ios/PommeCore.xcodeproj -scheme PommeCore-macOS -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO build`. Device: `./scripts/install_iphone.sh` (team `RSXSFPWG5J`).
- **Floors:** iOS 18 / macOS 15 / watchOS 11. Widget target wants iOS 26.4. Watch schemes cannot be built (missing PommeCoreWatchKit).
- **Checks:** `python3 scripts/add_ios_source.py --check`, `python3 scripts/check_ios_design.py`, `python3 scripts/check_sheet_chrome.py`, `./scripts/test_all.sh --host-only`.
- **Web:** `pnpm --dir webapp dev` on :3002. Tests: `pnpm --dir webapp test`.
- **Argent:** native iOS only. Use `describe`, not `debugger-component-tree`.

## Web design direction

See [web-polish-memory.md](web-polish-memory.md) for the user's copy, six-screen
intro, requested Apple Design / Appllama skills, and browser QA preferences.

## Map design skills and product direction — 2026-09-08

The user explicitly requested Apple Design and Appllama, an app-owned coverage
map, and matching capabilities on iOS and web. Read [design-guidance.md](../docs/design-guidance.md)
for the project rules and pinned upstream provenance. All files for `apple-design`,
`appllama-app-design-skill`, and `appllama-usage` were verified byte-identical in
both `~/.agents/skills/` and `~/.codex/skills/`; existing installations were preserved.
Read their full SKILL.md files when relevant. Appllama MCP was unavailable; do not
claim its reference library was used. Keep SwiftUI/MapKit and React/Leaflet, existing
visual identities, and equivalent feature meanings. No competitor UI embedding or
competitor branding in product flows. Only authorized external coverage data.
Persistent files are the memory mechanism; do not claim permanent model memory.
The current explicit browser policy is Arc/Playwriter only; older memory about
other browser tooling does not override it.

## Coverage and radio continuation — 2026-09-08

Lilyshark now owns the coverage UI in `NativeCoverageView`/`CoverageMapView` and
`CommunityCoverageMap`/`CoverageCanvas`. Preserve My mesh and the distinct
connected-radio position. Do not replace these maps with an iframe or web view.
The public directory provides repeater positions; regional coverage needs an
authorized feed. Fixtures used for visual QA are synthetic, never live coverage.
See [coverage-map.md](../docs/coverage-map.md) for capabilities and setup, and
[radio-map-visibility.md](../docs/radio-map-visibility.md) for the firmware audit.

The firmware config encoder now reports the active supported Meshtastic PHY,
and the BLE service forwards new self GPS positions locally. Both client
protobuf parsers decode those actual radio settings; preset-derived frequencies
remain unknown. The firmware still exposes Meshtastic BLE, independently of its
RF profile. A handheld is not automatically a public repeater listing, and a
radio announcement is not an authenticated survey upload.

The shared coverage credential belongs only to `services/pulse-api` backend
`COVERAGE_API_KEY`. The existing persistent `DATA_DIR/shelby-pulse.db` reserves
each refresh before a provider request and retains snapshots, ETags and 429
cooldowns across restarts. Vite/Vercel only proxy the public backend response;
do not move this quota state back into serverless process memory.

No regional API credential or physical T-Deck was supplied, and no deployment,
TestFlight distribution or hardware flash was performed in this pass. Preserve
these limits when resuming; simulator and fixture tests do not prove reception.

On this Mac, the default Node is x64 but installed frontend native dependencies
are arm64. Prefix web commands with
`PATH=/Users/maxmohammadi/.nvm/versions/node/v22.22.1/bin:$PATH`.
Use an isolated QA bundle ID (`com.lilyshark.coverageqa`) for Argent reinstall;
do not uninstall the real app. Other sessions may control booted simulators.

## Guided welcome home — 2026-09-08

Disconnected iPhone Messages is `WelcomeHomeView`: interactive T-Deck, pinned
Connect, pairing steps, capability cards, and a labelled Meshtastic flood vs
MeshCore routed demo. iPad/macOS use the same view as the split-view detail.
The scanner no longer auto-presents on first launch; background scan still
starts. Web INTRO keeps the 12 chapters and 42 screens; first chapter adds
Connect, chapters 3–4 show the same routing demo. Do not rewrite intro copy.
