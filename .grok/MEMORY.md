# Project Environment

Latest web pass: [simple intro and real web data](../docs/overnight-web-qa-2026-09-16.md).
User explicitly rejected diagrams and the oversized device. Intro now has ONLY
model + title + paragraph; 12 chapters/33 screens retained. Smaller portrait
model, full text on short phones, and desktop max model height 620px. Do not
restore older larger framing or chapter CTA/diagram blocks. Vertical pan remains.
Normal startup seeds NO demo nodes/messages/captures/unread. Demo is explicit,
marked, removable, and cannot own incoming real NET data. Public MeshCore map
uses full identities, separate advertisement/update dates, disk cache, and
refresh feedback. Latest live count 62,222. Public relay off unless opted in.
Web drafts scope by identity/conversation, persist locally, guard stale tabs;
reconnect same radio to restore radio-specific drafts after reload. History
preserves origin and send evidence; real radio updates clear external evidence
without redating or inheriting its position. 654 web tests pass. Physical Safari
and radio sends were not checked. ARM Node v22.22.1; local Vite on port 5173.

Latest pass: [real public MeshCore map and saved radio browsing](../docs/real-mesh-map-qa-2026-09-15.md).
Normal Map defaults to official MeshCore published nodes; My mesh remains radio-only.
Normal isolated simulator bundle com.lilyshark.analyzerqa replaces the old fixture.
Public directory persists in Application Support; source and advertisement/update dates
remain separate. Search/parsing off-main; map rebuilt on directory generation.
Radio snapshots are encrypted under per-radio MessageStore keys, omit channel secrets,
and check full identity on load. Retain for offline browsing, clear before new session,
gate sending on ready + fresh selfInfo. Do not claim physical-radio verification: both
physical devices are unavailable. Original tour preserved; simulated pairing now needs
--lilyshark-simulator-preview. Fixture compile flags never used for the real map proof.


Earlier pass: [node/map navigation and sizing](../docs/node-map-qa-2026-09-15.md).
Map pins open an in-place summary; Nodes searches names/keys and includes missing
positions. Chat/details Show on map focus explicitly; plain return preserves
camera and selection. Internet nodes opt in; Coverage lazy; phone permission
only on explicit action. ContactStore.reportedPosition is shared validation;
never date it from lastAdvert/lastHeard. Fix time/accuracy are not retained.

User screenshots caught mixed typography caused by LARGE_TYPE inside meshTheme
and .large forced inside MeshFixtureHost. Removed theme typography override.
ChatFixtureApp now owns one AppStorage uiFixtureTextSize (standard/large/largest)
at its window trait boundary; MeshFixtureHost Scenario changes that value. The debug header stays
compact. Use this one fixture build for all sizes; do not reintroduce nested
font-size overrides or trust older AX screenshots as proof of AX layout branches.

The earlier disconnect data-loss gap is implemented in the real-map pass above:
per-radio context persists encrypted and restored browsing is gated from sending.
Physical-radio reconnect/background behavior still needs hardware validation.
No offline basemap tile downloads or real position-age metadata were added.


Latest pass: [message delivery and actions](../docs/message-delivery-qa-2026-09-15.md).
Details is available from outgoing status and explicit message action menus for
all conversation types. It observes the live message, preserves the selected
radio context, gates retry, and exposes only retained evidence. Expected ACK is
not received ACK; stale RTT is hidden; attempt resets per phase and must not be
shown as total transmissions. Legacy channel `.repeated` is unmatched RX activity.
The retry engine and late-ACK timeout behavior remain unchanged.
Visible menus are the verified route to actions: native text selection competes
with long press, so do not claim that gesture is repaired. Quote's decorative
rule is now an overlay; a flexible Rectangle in the composer had covered history.
Outgoing metadata stacks at accessibility sizes; Today keeps layout priority.
Normal iOS/macOS builds and 14 evidence/persistence/text-budget tests pass.
Argent validated status/menu routes, retry updates, offline gating, copy/quote/
forward entry, accessibility5 chat and accessibility3 sheets. The fixture's
Largest text switch does NOT size sheets; use the existing LARGE_TYPE build flag
for the sheet boundary. Final fixture restored to standard text; no OS text-size
change. Next implementation: node → position/age/source → conversation → return
to map, with missing/stale/offline states. Physical radio validation is pending.

Latest MeshCore pass: [product direction](../docs/strategy/meshcore-app-direction-2026-09-14.md)
and [UI QA](../docs/meshcore-ux-qa-2026-09-14.md). User wants the best MeshCore
post-connection experience and explicitly does not want more questions. iPhone
Messages is now a real inbox (message recency, people/rooms with history/drafts,
full-row compose targets); Nodes filters by role and offers immediate actions.
Contact-book/groups remain under More → Manage contacts. Node browsing no longer
auto-requests status. Room/repeater forms scroll at large text sizes; room login
must not clear unread messages until history is shown. Radio leads with supported
MeshCore monitoring. Delivery details are now implemented above; next is the
node/map/offline workflow. Fixture now defaults to MeshCore and can simulate room
access; both UI compilation flags are still required for persistence isolation.
Argent UI checks use only simulator 9DF35957-E4CC-4D69-AC93-3D0CEE0DF7A0 and the
isolated com.lilyshark.analyzerqa bundle. Physical radio behavior is not validated.

Latest continuation: [September 14 status](../docs/continuation-status.md) and
[connected UI report](../docs/connected-ui-qa-2026-09-14.md). Work remains local
and uncommitted. Argent 0.22.1 is available and working in the resumed session.
The MCP command must start `/usr/bin/arch -arm64`, then the absolute Node
22.22.1 and Argent CLI paths; prepend that Node bin directory to the server PATH.
The explicit architecture fixes inherited Intel preference in the native helper
(SimulatorKit had ARM64 while the child wanted x86_64). A shared tool-server
started before this fix needs restarting through the explicit ARM CLI as well.
The package was not upgraded. Do not repeat the old absent-MCP diagnosis.

Latest user priority: improve what the iPhone app lets people do after connecting,
including its UI and everyday flow. The user explicitly rejected further radio
diagnostic questions. The new iPhone Mesh tab leads to known nodes, reported
positions, messages, and radio tools. Messages has a compose sheet, clearer
channel naming and ordering, persistent tabs, and simplified contact actions.
Radio leads with analysis/planning; the existing deck tour is under Explore.
Simulator routes, same-conversation reopening, draft preservation, node-ID search,
empty/offline states and largest-text layouts were checked. Normal iOS/macOS
builds and design/source/sheet checks pass. Physical phone validation is still
outstanding. `MeshFixtureHost` requires both chat-fixture and mesh-fixture compile
flags; it must never be used as proof of radio reception or delivery.

The iPhone 17e walkthrough used isolated `com.lilyshark.analyzerqa`, preserving
the real app and its pairing. Import/export, malformed/cancel preservation,
frame bytes, filter/reset, and Spectrum pause/clear/background checks passed.
Fixed missing Clear toolbar action, visible/adaptive filter labels, and Radio
rows wrapping at accessibility text sizes. iOS/macOS builds and 27 capture host
tests passed. Largest-text QA was restored to the standard Large category;
Reduce Motion remains off and its walkthrough is still pending. AX can show
stale underlying-sheet elements: prefer native app-scoped discovery for this
SwiftUI app. Settings AX reads sometimes need a scoped server restart.

The current browser policy authorizes Arc and Polar; use the named browser or
an existing relevant login, with Arc/Playwriter the default. Preserve profiles.

Native analyzer continuation: Traffic has profile/origin/CRC/direction/hex
filters, byte-preserving `.lscap` and CSV export, and structural protocol fields.
Mac Spectrum uses the existing LSK USB link for explicit scans; iOS remains a
labelled preview until analyzer transport exists. USB cancellation now prevents
delayed retries from reopening a cancelled port. Mac Traffic now records complete
USB frames to bounded `.lscap` files, saves on stop/dismissal/disconnect, retains
failed saves for retry, and lists recent recordings. Frame-detail navigation
does not end recording. September 14 adds native Reticulum announce fields,
clear opportunistic LXMF content, and unverified raw Shelby pointer structures,
using existing web/firmware fixtures and exact selectable byte ranges. Keep
payload decryption, signature verification, annotations, iOS analyzer BLE, and physical verification
tracked separately from these completed implementation changes.

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
The current browser policy authorizes Arc/Playwriter and Polar. Older Arc-only
notes do not override the current user instructions.

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
starts. Web INTRO keeps the 12 chapters; first chapter adds
Connect, chapters 3–4 show the same routing demo. September 13 user correction:
33 screens remain, including four setup/control screens instead of thirteen;
the twelve chapter texts remain. Do not rewrite intro copy.

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
