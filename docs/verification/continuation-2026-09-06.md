# Lilyshark continuation, September 6, 2026

Work started from `179358d` on `codex/resume-design-and-reliability`.
The interrupted Claude design workflow returned eight null results: none of
its design agents ran. Six uncommitted files were present at handoff; their
changes are preserved. A baseline patch is saved locally at
`/tmp/lilyshark-before-codex-20260906.patch`.

## Project environment

The Argent inspector classified this as native SwiftUI iOS/macOS, React/Vite
web, and PlatformIO firmware. It is not React Native. The structured result
is in `project-environment-2026-09-06.json`. Browser verification uses Arc and
one Playwriter session. Native verification uses Argent on the existing
iPhone 17 simulator.

## Changes under review

| Area | Implemented behavior | Design rules applied |
| --- | --- | --- |
| Home | Contact rows show identity, latest message, time, and unconfirmed delivery. Connection copy describes loading or readiness. The toolbar wordmark remains. | `system-visual-hierarchy`, `product-list-cells`, `converse-nav-bar` |
| Chat | Failures retain the deck's reason and offer retry on the same message. Incoming messages preserve the reader's position. Read status requires a visible, active conversation. Historical incoming routes are not inferred from current outgoing paths. | `product-transitions`, `empathy-voiceover-labels`, `system-typography` |
| Nodes | Details distinguish packet reports from deck records and preserve optional signal, hops, timestamp, position, and MQTT provenance. Advertisement discovery has no invented zero measurements. | `layout-grid`, `system-visual-hierarchy`, `product-content-unavailable` |
| Settings | Auto-add switches occupy separate rows. Unknown readings are explicit. Device controls follow the connected protocol's capabilities. | `product-list-cells`, `taste-button`, `system-standard-margins` |
| Connection | Scanning identifies Lilyshark decks and MeshCore radios, explains the current wait, and distinguishes missing Bluetooth signal from real readings. | `product-loading-states`, `product-content-unavailable`, `system-sf-symbols` |
| Navigation | Native iOS has Messages, Map, Radio, and Settings tabs. The existing desktop split navigation remains. | `converse-hierarchy`, `converse-tabview`, `converse-navigationstack`, `converse-toolbar` |
| Empty states | Contact, channel, map, discovery, telemetry, RF monitor, path, and planning views explain missing data and the next useful action. Frequency scan observations identify contact updates and unconfirmed tuning. | `product-content-unavailable`, `product-loading-states` |
| Motion and controls | Explicit animation uses the Reduce Motion helper. Touch-target frames are inside actionable labels; the modifier documents the ancestor-label distinction. | `empathy-touch-targets`, `empathy-reduce-motion`, `product-with-animation`, `product-transitions` |

The Radio tab exposes the native planning and MeshCore tools already available.
It does not add the web app's USB analyzer transport to iOS. Complex editing
tasks still use sheets. The existing composer and semantic bubble typography
were retained rather than replaced with a new chat design.

Additional reliability fixes:

- Unsigned iOS/macOS builds avoid creating entitlement-dependent CloudKit
  containers. Signed Release settings retain the existing cloud capability.
- Truncated device-statistics and self-info replies cannot create successful
  receipts containing substituted zero readings.
- Nonfinite or negative voltage reports remain unavailable. Interrupted sends
  reopen as unconfirmed, with a retry warning; changing conversations resets
  draft and visibility state for the selected peer or channel.
- Firmware airtime arithmetic uses a wide intermediate for long preambles.
- The native airtime calculator uses the coding-rate denominator correctly and
  matches firmware fixtures, including SF5/6. Its canonical 13-byte
  SF7/125 kHz/4/5 result is 46.336 ms; it previously showed 30.976 ms.
- Firmware and web decode reference LXMF title/content order and stored versus
  opportunistic framing. Signature and stamp presence do not imply verification.
- USB sends register their response waiter before writing and retain failure
  reasons. Local send success and captured outgoing echoes stay unconfirmed.
- `LSK T` adds `latest_pf` and `latest_dir`; the web uses them to distinguish
  receive measurements from transmitted frames and absent metadata.
- Meshtastic transmissions require a Meshtastic profile, including startup and
  link-handshake node advertisements. BLE returns a refusal when the profile is
  incompatible.
- CI installs its icon-check dependencies. Icon comparison checks RGBA pixels
  instead of PNG compression bytes. Source registration checks resolved paths
  and compile-phase membership.
- Commit `23d98cb` removes 2,554 generated Swift build files from version
  control. Their local files remain. This is repository cleanup, not added
  application functionality.

The follow-up mobile pass removes authored emoji decorations from both apps.
Native controls use SF Symbols and web controls use SVG icons. Legacy group,
reaction, and waypoint payloads remain compatible, but their UI renders symbols;
message text and names supplied by people are preserved.

Native primary, secondary, and plain actions share button styles with minimum
44-point targets and destructive roles. Web actions share sizing, focus, and
disabled styling, with 44-pixel mobile controls. Onboarding is four scrollable
pages with a persistent action bar. Parameter and measurement rows stack when
needed, and the sensitivity table uses full-width readings. Web onboarding,
chat, telemetry, and flasher layouts were checked at 320 and 390 pixels.
Two unused Xcode widget templates containing sample emoji content were removed;
the three registered widgets remain.

## Verification

- Baseline: GitHub web and iOS jobs passed; firmware CI stopped at the icon
  check because Pillow was absent. Local icon checks also rejected losslessly
  optimized PNGs even though all pixels matched.
- Web checkpoint: 552 tests, TypeScript, and production build pass. Arc verified
  USB failure and retry with a mock serial port, reading-position preservation,
  mobile layout, reference LXMF content, and unknown versus real-zero telemetry.
  Explicit-unavailable battery reports clear older readings; omitted reports
  preserve them and a real zero remains a reported value.
- Firmware wave: ASan/UBSan airtime/radio/LXMF checks, 31,855 parser mutations,
  fake-device scenarios, simulator build, and T-Deck build pass. Real upstream
  LXMF fixtures establish title/body order and explicit framing.
- The integrated iOS simulator build passes. Its generated Info.plist disables
  CloudKit for the unsigned build. Release build-setting checks and a focused
  capability harness passed. MeshCoreKit passes 55 tests and MeshtasticKit
  passes 113 tests. The final host-only gate includes the macOS app build and
  passes, as do all six source-membership and icon regression tests.
- Native checks passed onboarding, scanner, the home wordmark, Public Channel,
  Settings, Map, and Supporters Wall. Reduce Motion navigation was checked and
  the simulator settings were restored. The separate `accessibility3` Debug
  build checks larger text without changing the system slider; see
  `ios/BUILD.md` for the command.
- Refreshed large-text checks cover the Contacts header and action row,
  full-width channel and Radio tool text, the Appearance menu, and both scanner
  states. The ordinary app was restored and launched successfully. Only the
  session's iPhone simulator services were stopped. Screenshots and detailed
  limitations are saved locally in `/tmp/lilyshark-ios-qa-final/README.md`.
- The full gate exposed an existing stale STORAGE render reference. The old
  image showed fabricated capture filenames; current code already said
  `SIMULATED - NO FILE ON THIS BUILD`. Pixel comparison confined all 903 changed
  pixels to those two lines. Only that reference was refreshed. All 43 render
  checks pass. The full gate passes simulator scenarios, motion and README
  animation checks, the T-Deck build, and factory image validation.
- Two forced-clean firmware release builds are byte-identical at the same
  `SOURCE_DATE_EPOCH`. GitHub's Linux compiler also exposed unchecked shell
  cleanup in a host filesystem test; cleanup now uses the filesystem API and
  checks errors. The focused sanitizer test passes, including a scratch path
  containing an apostrophe.

## Integration with current main

Main advanced to `a4bb505` during the continuation. Merge `f0a4725` preserves
its focused flasher layout, real T-Deck photography, shared navigation, history,
and installer recovery while retaining the fixes above. The merged web app
passes 552 tests, TypeScript, production build, and Arc checks at 320/390 pixels.

Calculator inputs preserve partial typing and show range guidance only when
invalid. Results stay hidden until inputs are valid. Both native targets compile
after that final correction. Simulator entry checks confirm that `4` can become
`433` and `-` can become `-120`, while an invalid sensitivity hides numerical
results and shows range guidance.

## Saved worktree inventory

The older Claude worktrees remain available and unchanged. Their contents
are not assumed to be complete or correct merely because tests pass.

- `wf_ca3f33ef-621-10`: standalone MeshCore participation code and tests, not
  integrated into the device loop.
- `wf_ca3f33ef-621-12`: Meshtastic metadata work still needs review.
- `wf_ca3f33ef-621-14`: Reticulum verification has a compile error and a
  32-byte SHA-256 write into a 16-byte destination. Do not merge as-is.
- `wf_ca3f33ef-621-9`: spectrum changes need a review of occupancy semantics;
  its tests expect a steady strong carrier to report 0%.
- `wf_ca3f33ef-621-13` and `-15`: analyzer/LXMF work was reviewed; the smaller
  verified fixes described above were implemented in this branch.

## Boundaries

No physical T-Deck has been flashed or used to transmit during this run.
Hardware reception, BLE pairing, microSD, and on-air delivery still require
physical verification. Watch targets require the unvendored private
PommeCoreWatchKit package. No claim of a complete overnight run is implied
by these checkpoints.
