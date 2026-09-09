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

Disconnected iPhone Messages is `WelcomeHomeView`: one page scroll, sticky
Connect above the tab bar, interactive T-Deck as the first hero (no card,
no clip — chassis + SMA in frame; the whip may leave the top of the
stage), then welcome copy, pairing steps, capability cards, and a labelled
Meshtastic flood vs MeshCore routed demo.

SceneKit framing must use the *rotated* AABB (`convertPosition` of the
eight corners after the −π/2 pitch). `boundingBox` ignores the node's own
eulerAngles, which cropped the LCD/bezel inside a rounded window. Camera
recenters on the chassis so idle yaw stays on the handset. `TDeckStage`
is ~52% on Welcome (min 420pt). The Connect fade is 12pt so the three
steps stay readable above the button. Onboarding still uses ~56%;
“Look around the deck” sits under the drag hint, not under Continue.
Conversations is a push off that
welcome, with Back. iPad/macOS use the same view as the split-view detail.
The scanner no longer auto-presents on first launch; background scan still
starts. Web INTRO keeps the 12 chapters and 42 screens; first chapter adds
Connect, chapters 3–4 show the same routing demo. Do not rewrite intro copy.

## Simulator Bluetooth pairing preview — 2026-09-08

The iPhone Simulator cannot hear BLE, even with a physical T-Deck powered on
and USB-plugged (`/dev/cu.usbmodem101`). On simulator, Connect a Radio fades
in a “Lilyshark T-Deck Plus” Meshtastic row, then a pairing sheet with the
3D deck, PIN `123456`, and Pair (six digits submit automatically). That is a
UI walkthrough, not a live GATT link. After Pair, compact Messages shows
Ready for messages / Lilyshark, then Public Channel above a one-row empty
contacts note. The composer sits in a bottom safe-area inset so the floating
tab bar does not cover it. Disconnect via `endSimulatorDeckPreview`. A real
phone is required to pair the physical deck. Do not uninstall
`com.lilyshark.app`. Overlay-install rebuilt `.app` bundles; do not use
Argent `reinstall-app` on the real bundle id.

Pairing-sheet polish (2026-09-08): native inline title “Bluetooth Pairing”
with Cancel / Pair, drag indicator, `.large` detent. The PIN lives on the
deck LCD via `ios/Resources/TDeck/screens/pairing.png` (not a sticker over
the chassis). Digit cells sit in a bottom bar above the number pad; six
digits submit; mismatch shakes and haptics. Scanner copy is one line.
Empty contacts: “They appear when this deck hears someone on the mesh.”
Verified overlay-install on iPhone 17 (`B365CF55-6DAC-4513-995F-853C1884D68F`).

## Web intro T-Deck is 3D-first — 2026-09-09

Intro never paints `/intro/tdeck.webp`. The GLB parse starts with the app
module graph (`preloadTDeck` from `main.tsx`); the chassis is cloned onto
the canvas as soon as that parse finishes. A missing LCD PNG must not hide
the model. Rest pose is a three-quarter tilt (`REST_YAW` 0.58, `REST_PITCH`
0.36). Drag orbits yaw freely with pitch; the pose stays where the pointer
leaves it (Home restores rest). Flash still uses the photograph. Arc-checked
at 1440×900 and 390×844 on `http://localhost:3002/#intro`. Do not commit
unless asked.
