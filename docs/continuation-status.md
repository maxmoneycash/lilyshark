# Lilyshark continuation — 2026-09-16

The recovered conversations cover the web intro and analyzer polish, plus the
native home, onboarding, and coverage maps. The current branch is `main`, based
on `b2b1d14` (September 10). This continuation's changes are local and uncommitted.

## Overnight 2026-09-18: intro sizing on branch `intro-sizing`

Max wants one design everywhere: the pinned 3D T-Deck whose screen changes
as you scroll (restored on main, live). The phone-only page from earlier on
2026-09-17 was a mistake and is gone. Only sizing of the text and model is open.

On the branch (not on main, not deployed): the phone copy takes its natural
height and never scrolls inside itself; the device box is sized from the
stage height minus the measured copy height (`--intro-copy-height`, published
by IntroTab) minus padding/gap, floored at 150px and capped at 60dvh;
headline clamp(22px, 6.4vw, 30px), body 15px, a step down under 700px tall.
`#intro?chapter=N` deep-links to a chapter. tdeck-scene repaints synchronously
on resize (a resize clears the canvas and the queued frame could be dropped).
Also on the branch: the CI-failing LSKSerialLinkPtyTests cancel test now waits
for the fake deck's reader to go quiet before taking its baseline (11/11 pass
locally).

Verification path used tonight (no Playwriter extension connected in Arc or
Polar): serve `webapp/dist` on 127.0.0.1:4173, expose it with a Cloudflare
quick tunnel (`cloudflared tunnel --url`, binary in the session scratchpad),
and render through api.microlink.io at exact viewports (WebGL renders there).
Renders at 390x844 and 390x701 are right: device fills the space above larger
text, no dead gap. At viewport heights <=700 the device box is correctly sized
but painted blank in that renderer; production at 390x700 renders. Cause not
yet established; Polar's agent was asked to measure the DOM at 390x700.
Microlink's free daily quota ran out; a search for another renderer is running.

## Superseded: phone intro as an ordinary page — September 17 (reverted)

Max said the mobile intro was still bad after the September 16 sizing pass.
Below 861px the pinned, scroll-snapped sequence no longer renders; `IntroPhone.tsx`
shows the headline, the lead, the 3D device (cycling splash/home), then the other
eleven chapters each with its real firmware screens in a sideways strip with
plain-word captions (`intro-copy.ts`). Desktop keeps the pinned stage. Tests:
656 pass (two new: chapter/screen parity, asset + label for every screen).
TypeScript and the production build pass. NOT yet seen in a browser: the
Playwriter extension was not connected in Arc or Polar this session. Also
noted: competitor Waveshark (github.com/v0l/waveshark), SDR-based, decodes
Meshtastic/MeshCore among 45+ protocols.

## Earlier: simple intro and real web data — September 16

The user explicitly rejected intro diagrams and said the enlarged device was
now too big. INTRO now contains only the device, title, and paragraph. Removed
diagrams and chapter action rows; reduced model size and prioritized readable
text on short phones. Keep 12 chapters/33 screens. Do not restore the oversized
layout below. Phone, small phone, wide phone, landscape, and desktop checked.

Normal web startup no longer seeds fake nodes, messages, captures, or unread
badges. Optional demo is visibly marked and removable; real data ends the sample
session. Public Map defaults to real MeshCore directory records (62,222 at the
latest check) and saves their positions for offline browsing. Advertisement and
record-update dates remain separate. Relay sharing is off by default.

Conversation drafts are saved separately by radio/conversation, with guards for
failed sends and stale browser tabs. Saved history retains source and delivery
evidence; loading history cannot replace newer radio observations. Real radio
evidence clears old external/simulated fields without claiming their positions.
Radio-specific drafts return when the same radio identity is known again.

See [the September 16 work and QA report](overnight-web-qa-2026-09-16.md).
Latest full web suite: 654 tests pass. Work remains local and unpublished.

## Superseded sizing: larger mobile web intro — September 15

Portrait intro now puts the large T-Deck above compact chapter text. Tightened
camera fitting, expanded the mobile canvas, and fixed the wrapper's touch-action
so vertical swipes over the model scroll both ways; horizontal drags rotate it.
Preserved all 12 chapters and 33 selected firmware screens. Verified Arc layouts
from 320×568 through desktop and actual emulated touch input. All 621 web tests,
TypeScript, and the production build pass. Preview: http://127.0.0.1:5173/.
See [the mobile intro report](mobile-intro-qa-2026-09-15.md). Physical Safari was
not checked in this pass. Work is local and unpublished.

## Earlier: real MeshCore map and saved radio browsing — September 15

Map now defaults to the official MeshCore public directory, using full published
identities and coordinates. The normal simulator build replaces the previous isolated
fixture; it has no simulated radio or contacts. Directory parsing/search run off the UI
thread, cached records survive launch, and public-node details distinguish advertisement
date from record update date. Fixed overlapping source/search controls and missing pins
after the initial download. See [the real map report](real-mesh-map-qa-2026-09-15.md).

Implemented encrypted per-radio browsing snapshots and retention on disconnect/launch.
New connections clear saved navigation and data before radio frames arrive; sending
requires a ready connection and fresh radio identity. Snapshot tests cover encryption,
full-identity isolation, and unavailable-key/plaintext rejection. Fixture data is excluded
from snapshot saving/restoring. Physical iPhone and iPad are unavailable to devicectl;
radio end-to-end, device switching and background recovery still require hardware QA.
No physical install, publish, push or commit was performed. The original T-Deck tour is
preserved. Simulator pairing demonstration now requires the explicit launch argument
`--lilyshark-simulator-preview`.

## Earlier: node/map navigation and consistent sizing — September 15

Implemented in-place map node summaries, searchable nodes including missing
positions, role-specific actions, Show on map from conversations/details, and
camera/selection retention. Internet nodes are opt-in; phone location is an
explicit action. Position time/accuracy remain unknown because general node
activity cannot date a coordinate. See [the map QA report](node-map-qa-2026-09-15.md).

The user's simulator screenshots exposed inconsistent sizing caused by the
large-text QA override inside `MeshThemeModifier` competing with the fixture's
normal-size override. Removed typography from the theme and moved fixture text
size to its app window traits. Scenario offers Standard, Large, and Largest text; all
screens and native sheets use the same window text-size trait. The test banner stays compact. Earlier
large-text screenshots with the nested theme override are not evidence that
all layout branches received the same text size as their rendered labels.

The disconnect-retention gap identified in this pass is implemented in the real-map
pass above. Its physical-radio and background/reconnect validation remains outstanding.

## Earlier: message delivery and actions — September 15

Implemented message details for direct, channel, and room conversations, with
plain-language evidence, a live retry result, copy feedback, and explicit message
action menus. Corrected channel “Repeated” presentation: the stored observation
is unmatched radio activity, not proof of repetition. Expected ACK codes do not
prove delivery, and the phase-reset attempt counter is not a total send count.

UI checks also found and fixed a quote preview that expanded over the message
history, squeezed delivery labels at accessibility sizes, and a wrapping date.
Long-press/native text-selection competition remains; the explicit action menu
is the verified route to Quote, Forward, and Details. Text selection is retained.

Normal iOS and macOS builds, source/design/sheet checks, and 14 focused package
tests pass. The isolated iPhone fixture verified direct/channel/room/transport
semantics, retry updates, offline gating, actions, and accessibility layouts.
See [the report and screenshots](message-delivery-qa-2026-09-15.md).

Next implementation: the node → reported position → conversation → return-to-map
flow, including report age/source and missing/stale/offline states. Delivery's
physical-radio, interrupted retry, late/duplicate ACK, and background checks
remain separate; the retry engine and timeout correlation were not redesigned.
All changes remain local and uncommitted. Nothing was deployed.

## Earlier: MeshCore daily use and product direction — September 14

The user asked to keep improving the app and establish how it can become the
best MeshCore app, with no more questions. The direction is a clear daily-use
loop: communicate, understand what the radio knows, explain delivery, and offer
the right next action. See the [grounded product plan](strategy/meshcore-app-direction-2026-09-14.md).

Implemented an iPhone conversation inbox ordered by message activity; draft
previews; separate compose sections for rooms/people; role filters in Nodes;
prominent node actions; explicit status requests; and live MeshCore tools first
in Radio. Contact-book and group management remain under Messages → More →
Manage contacts. Fixed missed taps on short compose rows, non-scrolling login
forms at accessibility sizes, and room login incorrectly clearing unread history.
The fixture now supports MeshCore roles as well as Meshtastic. See the
[QA report and screenshots](meshcore-ux-qa-2026-09-14.md) for validation and limits.

The delivery-details presentation planned here is implemented in the September
15 pass above. Source inspection ruled out presenting the phase-reset attempt
counter as a total. The node/map/offline flow follows next. Keep physical-radio
authentication, delivery and recovery checks distinct from simulator UI evidence.

## Earlier: connected iPhone UI — September 14

The user explicitly redirected the work to the post-connection experience and
asked for no more diagnostic questions. Added a Mesh starting tab, searchable
node directory, node-to-message routes, and a compose sheet; simplified Messages
and Radio, selected My mesh for the map, and fixed tab/title/unread layout issues
found during interaction. iOS and macOS builds and source checks pass. Main
routes, draft restoration, empty/offline states, node-ID search, and large text
were checked using an isolated simulator fixture. Physical phone/radio behavior
is not established by these checks. See the [UI report and screenshots](connected-ui-qa-2026-09-14.md).

## Earlier: native analyzer QA — September 14

Argent now works with explicit ARM architecture for Node and its native helpers.
The iPhone walkthrough fixed Spectrum’s missing Clear action, visible capture
filter labels, and Radio row wrapping at accessibility text sizes. Imports,
exports, failure/cancel preservation, byte selection, filters, and Spectrum
pause/clear/background behavior passed. Both native builds and 27 capture host
tests pass. See the [QA report and evidence](native-analyzer-qa-2026-09-14.md).
Reduce Motion, iPad, dark appearance, VoiceOver navigation, Mac UI, and physical
radio checks remain. Earlier Argent-blocked notes below describe prior sessions.

## Chats recovered

These are the last two substantive GPT-6 Codex root conversations found for
this folder, excluding this recovery conversation and review subagents:

| Date (Pacific) | Codex thread | Work |
| --- | --- | --- |
| September 8, 03:18–13:09 | `01a08086-6967-79a2-8da1-16d6a5cf755f` | Web intro, original copy/screens, interactive T-Deck, web polish |
| September 8, 03:17–13:08 | `01a08085-ef1b-7d03-ad7f-eb6616d74798` | Native/web coverage maps, native home and onboarding |

Both identify `gpt-6-astra`. Their local rollout files are under
`~/.codex/sessions/2026/09/08/`; the thread IDs identify the filenames.

Two later Grok continuations are under the Lilyshark project in
`~/.grok/sessions/`:

- `01a082cf-3aa4-7401-8d86-d9e60834e45c` — “Restore Lilyshark intro sequence matching production,” last updated September 9, 17:58.
- `01a082ce-cedb-7751-8249-cfef4f3021e1` — “Interactive T-Deck home screen and mesh tutorials,” last updated September 9, 04:41.

The September 10 commits and original uncommitted native analyzer drafts were
newer than those conversations; their authoring chat was not established.
Git and the working tree are the implementation baseline, not a claim made in
an older chat.

## Changes in this continuation

- Registered the unfinished native capture/spectrum files in the canonical
  Xcode project and connected the capture inspector to the Traffic screen.
- Replaced unsafe capture reads with bounded, alignment-independent parsing;
  report malformed/truncated tails without scanning payload bytes for records.
  Imports run off the main actor and are limited to 32 MiB / 100,000 frames.
- Native traffic uses elapsed timestamps, honors missing metadata, distinguishes
  synthetic records, prepares chart buckets once, and exposes exact packet bytes.
- Native spectrum is explicitly a simulation. Its task cancels on dismissal,
  backgrounding, or reduced motion; Clear stops it and peak hold retains maxima.
- Fixed stale Settings preference references that prevented native compilation.
- Matched web capture validation to the format, corrected the browser writer's
  record header, and preserved compatibility with its older zero-header exports.
- Fixed undefined connection state in Mesh and the Telemetry type error.
- Repaired the intro's overlapping grid and camera framing. Text and device have
  separate areas on desktop and stack on phones. The chassis and antenna base
  stay framed through rotation; the long whip may leave the stage, as specified
  in the earlier design notes. The subsequent user correction below trims the
  screen selection while retaining the original chapter copy.
  Model loading and failure now have visible status text instead of an empty area.
- Mesh labels demo counts, explains the absence of recorded history, keeps empty
  content beneath the controls, and removes the scanline overlay from that screen.
- Restored keyboard focus outlines and reconciled stale source assertions with
  intentional changes such as full rotation and the current empty-state copy.

## Verification

- `./scripts/test_all.sh --host-only`: passed, including sanitizer-backed C++
  tests, Python/Swift checks, the macOS build, web typecheck, and 621 web tests.
- Native capture tests: 9 passed, including repository samples, signed values,
  unaligned records, extended headers, corruption recovery, missing metadata,
  legacy browser files, and import limits.
- Unsigned iOS Simulator build of `PommeCore`: passed.
- Web production build: passed; Vite still reports large output chunks.
- Task schema: 52 tasks, no errors. Whitespace check passed.
- Arc: intro and Mesh layouts visually inspected; Mesh Activity CONNECT opens
  the connection dialog. All 12 intro chapters passed geometry checks at
  320×568, 390×844, and 1440×900 (36 cases): no overlap, horizontal overflow,
  or device area outside the viewport. The smallest device area was 211 px tall.
  Rotated handset and reduced-motion rendering were visually checked. Traffic
  opened the 24-frame sample, recovered 23 frames from a truncated copy with a
  specific warning, and retained those frames after an invalid file failed to open.
- Native interaction was blocked during this initial recovery. The September 14
  device walkthrough above supersedes that status; its report distinguishes the
  completed checks from the remaining UI and hardware validation.

## Remaining work

The existing [task board](../tasks/README.md) records 41/52 tasks done. It does
not cover every native feature or establish release readiness. Its eleven open
tasks remain open:

| Tasks | Remaining deliverable |
| --- | --- |
| FW-001, FW-002, FW-008 | Physical T-Deck SD/touch/scan recovery, byte-compared over-the-air captures, endurance reports |
| FW-010 | LSK analyzer BLE service and hardware verification; existing Meshtastic BLE is a different service |
| CO-002, CO-003 | Durable contract deployment, recorded transaction evidence, and client address configuration |
| CO-004 | Registry v2 deduplication, pagination, and self-service anchoring |
| GR-003 | Pre-flashed hardware offering, dependent on hardware validation |
| GR-006 | Dated most-wanted cell output and publication from scorer data |
| GR-007 | External Reticulum announcement; draft/publication work needs separate tracking |
| PA-006 | Related-networks appendix in a regenerated, versioned PDF and matching web renders |

Additional gaps from the recovered work:

1. **Native QA:** the iPhone import/export, preservation, detail, filtering,
   large-text, and Spectrum pause/clear/background walkthrough now passes. Finish
   Reduce Motion, iPad, dark appearance, VoiceOver navigation, and Mac UI checks;
   see the September 14 QA report for precise coverage.
2. **Native analyzer parity:** Mac USB spectrum, structural protocol fields,
   capture filters, and `.lscap`/CSV exports are now implemented (see below).
   Reticulum announce, clear opportunistic LXMF, and raw Shelby pointer fields
   are implemented in the September 14 continuation below. iOS live analyzer
   transport, payload decryption, signature verification, and annotations remain.
3. **Coverage:** authorized regional provider credentials, deployment, and real
   survey/reception evidence remain unverified. Preserve the owned native/web
   map UI and keep synthetic fixtures distinct from received coverage.
4. **Watch build:** the required private `PommeCoreWatchKit` dependency is missing.
5. **Release:** no firmware flash, public deployment, external announcement,
   TestFlight upload, or App Store submission was performed in this continuation.

Continue with the remaining native UI checks, analyzer transport/decoder parity,
and the highest-priority hardware/deployment tasks.
Do not mark those tasks complete from compilation or simulated data alone.

## Subsequent intro correction — September 13

The user requested larger devices on crowded pages and fewer setup/settings
screens. The tour now has 33 screens, with the setup/control portion reduced
from 13 to four: setup welcome, setup profile, setup controls, and radio profile.
The twelve chapter texts and radio/capture screen selections remain intact.
Narrow layouts reserve more height for the handset, with a shorter routing-demo
caption and no fading mask over scrollable copy. Camera framing is tighter
around the chassis and metal antenna base.

Validation for this correction: 621 web tests, TypeScript, and the production
build pass. All twelve chapters passed layout checks at 320×568, 390×844,
500×1000, and 1440×900 (48 cases), with no overlapping columns/rows or page
overflow; opening actions remained visible at every size. All 33 stops and
the shortened setup sequence resolve to the intended firmware images.

## Native analyzer continuation — September 13

Traffic now filters by recorded protocol profile (including Custom), origin,
CRC, direction, truncation, sequence number, or exact payload bytes. Queries
are compiled once, executed off the main actor, and cancelled on replacement.
Resetting filters reuses the original analysis. Filtered charts retain the
capture's original time origin. No-match results do not claim absent timestamps.

Matching frames can be exported as `.lscap` or CSV. Binary exports copy the
original file header and complete selected records, preserving unknown header
extensions, reserved bytes, legacy layouts, provenance flags, and file version.
Damaged tails are omitted with a visible explanation. CSV leaves unrecorded
metadata blank and retains payload leading zeros. Network-relayed origin takes
precedence over synthetic flags; unspecified origin is not local RF evidence.

Packet details now decode profile-gated Meshtastic outer headers, MeshCore
routing/path/type fields, and Reticulum/RNode headers. Selecting a field
highlights its byte rows and exposes the exact selected bytes for copying.
Unknown/custom profiles, IFAC masking, split packets, unsupported versions,
and malformed/truncated layouts remain explicit. This is structural decoding;
no payload decryption, sender authentication, or semantic announce parsing is
claimed.

On macOS, Spectrum now uses the existing LSK USB transport: select a serial
port, connect, and request a single scan of the band selected on the deck.
The UI explains that scanning pauses packet reception. Start/stop replies,
malformed results, timeouts, cancellation, and disconnect are handled. Preview
data is separated from USB data, plot bins use the reported band and count, and
retuning resets history and peak hold. Power ticks, a visible trace legend, and
the strongest bin's frequency provide readable measurement context.

USB reads now use a nonblocking dispatch source on the same queue as writes
and teardown. Cancelling during USB re-enumeration invalidates delayed retries;
short writes fail visibly. Pseudo-terminal tests exercise the real file
descriptor transport, but do not establish physical radio operation.

Argent is configured and enabled in local Codex configuration, but its tools
remain absent from this running Codex session. Native visual/interaction QA
and physical USB/BLE/RF verification are still pending. No radio was flashed,
no app was uninstalled, and no release or deployment was performed.

Validation for the native continuation:

- `./scripts/test_all.sh --host-only`: passed, including the macOS build,
  17 native analyzer tests, sanitizer-backed firmware checks, and 621 web tests.
- `arch -arm64 /usr/bin/swift test --package-path ios/Packages/MeshtasticKit`:
  118 tests passed, including pseudo-terminal sweep and retry-cancellation cases.
- Unsigned `PommeCore` iOS Simulator build: passed.
- Native decoder fixtures match the existing web/firmware header vectors;
  lengths 0–255 were exercised for all three structural decoders.
- Export tests preserve extended/legacy headers byte for byte, drop damaged
  tails, preserve elapsed-time origin after filtering, and reject searches that
  would match across byte boundaries.
- Four read-only review roles completed; their material findings were fixed.
  Native design, sheet chrome, source membership, docs index, and whitespace
  checks pass. Simulator gestures, file-picker/export-sheet interactions,
  Dynamic Type, and physical radio operation are not covered by these results.

## Live capture and Argent repair — September 13

Argent 0.22.1 is installed under the Node 22.22.1 directory. Codex was configured
to run the bare command `argent`, which was absent from this session's PATH.
The local Codex MCP entry now names the installed ARM64 Node executable and
Argent CLI file by absolute path, with a 30-second startup timeout. The previous
configuration was backed up next to `~/.codex/config.toml`; every other MCP
entry was preserved. Path existence and the ARM64 runtime were verified.
The current tool catalog has no Argent tools or MCP reload operation, so this
repair is not a claim that native interaction QA has run. Codex must reload its
MCP connections to expose the repaired server.

Follow-up diagnosis: the active client is Codex CLI 0.146.0 running in Warp,
with no managed app-server control socket or listening control endpoint.
`codex mcp get argent --json` confirms the repaired entry is enabled and parsed
correctly. The installed protocol schema includes `config/mcpServer/reload`,
but that is an app-server request, not an available CLI command. OpenAI's
[app-server documentation](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
and [CLI command source](https://github.com/openai/codex/blob/main/codex-rs/tui/src/slash_command.rs)
confirm that distinction. No Argent startup or native QA success is claimed.

To reload this client's configuration while keeping this exact conversation,
exit Codex with `/quit`, then run in the same terminal:

```sh
codex resume -C /Users/maxmohammadi/lilyshark 01a09d42-aca4-7710-a5ce-df10d312792a
```

On resumption, use the new session's actual tool inventory to establish Argent
availability before native QA. Do not repeat installation questions or describe
the absence of tools as proof that the package is uninstalled.

The Mac Traffic Analyzer now records complete LSK frame records over USB,
stops at 32 MiB / 100,000 frames, and saves automatically on Stop, dismissal,
or cable loss. Completed captures open in the existing inspector and export
workflow. Recent captures remain available after reopening the sheet; Finder
can reveal the saved files. A failed save retains the recording for retry and
prevents a new recording from overwriting it.

The raw LSK decoder now validates all capture fields, numeric widths, and
payload lengths before a record is eligible for saving. Older or incomplete
records are counted as skipped rather than filled with zeros. Synthetic and
network-relayed flags remain explicit. Import requests have separate identities
so a cancelled import cannot clear a newer request.

Recording lifetime belongs to the analyzer sheet: opening a packet detail
does not disconnect USB. Export preparation snapshots the source filename with
the selected capture, so another import cannot rename an in-progress export.

Validation for live recording:

- 123 MeshtasticKit tests pass, including incomplete-record rejection, integer
  bounds, provenance, unsigned timestamps, and recording limits.
- 19 native host tests pass. A golden test recreates the repository's sample
  capture byte for byte from streamed LSK records. A pseudo-terminal integration
  test exercises the actual serial link and app recording session through normal
  stop, cable loss, failed filesystem save, retained data, and successful retry.
  It also verifies that the saved file appears in recent captures.
- Unsigned iOS Simulator and macOS builds pass. The full host suite passes,
  including the native checks, sanitizer-backed firmware tests, web typecheck,
  and all 621 web tests. Design, source membership, and sheet checks pass.
- Four read-only review roles completed; the export filename and sheet-lifetime
  findings were fixed. Native visual/interaction QA, sandboxed filesystem UI,
  and physical radio operation remain unverified by these host tests.

## Native packet content — September 14

The native packet inspector now shows Reticulum announce public-key, name-hash,
random-hash, optional ratchet, signature, and application-data ranges. The hop
count and optional transport instance are not presented as a complete route.
Announce fields require the expected destination and complete fixed layout;
split, IFAC-protected, invalid-hop, and truncated frames stay structural.
Keys, identity, destination derivation, and signatures remain unverified.

Clear Reticulum PLAIN DATA packets with context NONE can expose opportunistic
LXMF content: source hash, signature, timestamp, title, content, fields count,
and optional stamp. The bounded MessagePack reader distinguishes nil from empty
values, keeps exact source-byte ranges, limits nesting, checks lengths before
advancing, and rejects trailing bytes. Text previews replace control characters
and avoid splitting UTF-8 characters. Encrypted and control/context-bearing
packets are not classified as LXMF. Signature and stamp presence does not imply
verification.

The inspector also mirrors the firmware's independent SHLB scan. An 82-byte
structure must have the supported version and consistent chunk fields before
its commitment, owner, flags, size, expiry, and chunk information are shown.
It is labelled as an unverified structure found in raw bytes, even when an outer
protocol is unknown, malformed, or opaque. This does not decrypt that protocol
or fetch, verify, or publish a blob.

Validation: 27 native host tests pass, including the shared announce fixture
ranges, reference-generated LXMF messages, signed and unsigned timestamps,
nil/empty/text handling, hostile MessagePack lengths/nesting, truncation, packet
eligibility, and the firmware's golden Shelby pointer. Larger stored-message
fixtures test the pure parser directly because radio capture records are capped
at 255 payload bytes. The unsigned iOS Simulator and macOS builds, native source,
design, and sheet checks pass. The full host gate passes, including sanitizer
checks, the native tests, web typecheck, and all 621 web tests. Four read-only
reviews found no material issues. Native visual QA remains pending because this
session still has no Argent tools attached.

`/tmp/lilyshark-native-message-review.lscap` is a local review fixture containing
three announces and two LXMF messages from the pinned reference vectors. All
five records are marked synthetic and claim no RF readings or timestamps. The
host capture reader accepts the file; it is ready for the native walkthrough.
