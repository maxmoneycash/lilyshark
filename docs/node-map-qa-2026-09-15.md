# Node → map → conversation — September 15, 2026

## Result

A local map pin now opens a node summary in place. People have a Message action,
rooms have Open room, and infrastructure leads to node details and supported
tools. The Nodes sheet searches names and public keys and includes nodes without
a usable position. Those nodes show an explicit missing-position state and can
still be opened.

Conversations and node details offer Show on map. The map retains its camera and
selected node across Messages/Map tab changes. Explicit Show on map requests
focus that node, including a repeated request for the same node. A different
radio resets the previous radio's camera context. Node selection from search is
applied after sheet dismissal; keyboard layout changes do not become map state.

My mesh defaults to the radio's reported nodes. Internet nodes are an explicit
Layers option, and the community Coverage view is first created when opened.
Phone location permission is requested from Center on my phone. Denying it does
not prevent using the reported node positions; the location action offers a
Settings route when permission is denied. Empty maps do not invent a home city.

## Sizing correction from the user's screenshots

The screenshots exposed a test-environment defect: LARGE_TYPE in the theme
forced accessibility text inside screens while MeshFixtureHost forced normal
text higher up. Labels and layout branches received different sizes. A
SwiftUI-only root override also failed to resize presented native sheets.

Removed the nested theme override. The fixture now uses one text-size setting
applied to its app windows' preferred content-size trait. Standard, Large
(accessibility3), and Largest (accessibility5) are available in Scenario. This
changes only the isolated fixture's windows, not the simulator's system setting.
The fixture header stays compact. The normal app still follows the user's
system text size. Earlier large-text screenshots with the theme override are
not proof that accessibility layout branches ran correctly.

## Position evidence

`ContactStore.reportedPosition(for:)` now supplies the same validated coordinate
to Mesh home, map pins, map summaries, and node details. It rejects non-finite and
out-of-range coordinates. MeshCore's absent `0,0` differs from an explicitly
reported Meshtastic `0,0`; Meshtastic coordinates require field presence in its
position store. MQTT provenance is shown when retained with the position.

The app does **not retain a reliable position-fix timestamp or accuracy** in these
stores. General `lastAdvert`/`lastHeard` can advance without a new position;
MeshCore also normalizes missing contact timestamps to the current time. The UI
therefore says time and accuracy are unavailable, and that the location may be
older. It does not convert general activity into a fabricated location age.

## Validation

Used only the isolated `com.lilyshark.analyzerqa` bundle on the iPhone 17e simulator
`9DF35957-E4CC-4D69-AC93-3D0CEE0DF7A0` (iOS 26.5). Both mesh/chat fixture build
flags preserve the real app's persistence and pairing. Simulated nodes and
conversations are not proof of physical radio behavior.

Verified with Argent:

- Pin → summary → Message → Map retains selection and camera.
- Node browser groups usable/missing positions; public-key search finds Jordan.
- Missing-position selection keeps node actions available without inventing a pin.
- Repeater summary opens node details; Show on map returns and focuses its node.
- A conversation's Show on map selects that contact instead of the previous node.
- Phone permission appears only after the phone-location action; denial leaves
  local map browsing available, with a clear recovery action.
- Internet nodes load only after enabling the layer and disappear when disabled.
- At accessibility5, map controls remain compact and both Message and Details
  stay visible while the summary scrolls. At accessibility3, the node-list rows
  wrap and the node-details position fields stack vertically.

The large-text checks caught and fixed vertically broken map controls, a
truncated Details action, and latitude/longitude fields squeezing each other.
Search testing caught keyboard-induced camera changes underneath a sheet.
An explicit focus rebuilds the native Map view because MapKit can retain the
keyboard viewport when a new request equals its previous camera binding. Plain
tab returns preserve the existing map. The final same-node search return is
verified in screenshots 20–21.

Builds/checks: normal iOS simulator and macOS; the fixture with one window-level text-size control; source registration (116 files), design check (115 files), sheet chrome
(33 sheets), and `git diff --check`. No transport or retry-engine behavior changed.

## Evidence

Screenshots are in [the node-map evidence folder](qa/node-map-2026-09-15/).
Images 17–21 document the final sizing correction and camera fix; earlier images
record the individual flow checks before the final text-size mechanism changed.

- [Normal Mesh sizing](qa/node-map-2026-09-15/17-normal-mesh-sizing.png) and
  [normal map sizing](qa/node-map-2026-09-15/18-normal-map-sizing.png)
- [Selected node](qa/node-map-2026-09-15/02-node-summary.png)
- [Conversation](qa/node-map-2026-09-15/03-map-to-message.png) and
  [return to the map](qa/node-map-2026-09-15/04-return-to-map.png)
- [Node browser](qa/node-map-2026-09-15/05-node-browser.png) and
  [missing position](qa/node-map-2026-09-15/06-no-position.png)
- [Denied phone location](qa/node-map-2026-09-15/07-phone-location-denied.png)
- [Repeater](qa/node-map-2026-09-15/08-repeater-summary.png),
  [details action](qa/node-map-2026-09-15/09-node-details-map-action.png), and
  [conversation action](qa/node-map-2026-09-15/10-chat-map-action.png)
- [Public-key search](qa/node-map-2026-09-15/11-node-key-search.png)
- [Internet layer enabled](qa/node-map-2026-09-15/12-internet-layer-enabled.png) and
  [hidden](qa/node-map-2026-09-15/13-internet-layer-hidden.png)
- [Correct accessibility3 coordinate layout](qa/node-map-2026-09-15/19-large-text-coordinate-layout.png)
- [Search with keyboard](qa/node-map-2026-09-15/20-search-before-map-return.png) and
  [restored camera](qa/node-map-2026-09-15/21-search-camera-restored.png)
- [Accessibility3 node list](qa/node-map-2026-09-15/14-accessibility-node-list.png)
- [Accessibility5 actions](qa/node-map-2026-09-15/15-largest-text-map-actions.png)
  and [scrolling the report](qa/node-map-2026-09-15/16-largest-text-scroll.png)

## Remaining work

**Real disconnect retention is the next product gap.**
`PommeCoreViewModel.handleDisconnect` clears active device, contact, channel, and
message stores. The existing Saved data, offline fixture only changes readiness
and deliberately retains those stores. Its offline UI is not evidence that the
production app can browse the last radio's mesh after disconnect. Fix this with
explicit per-radio retained state and read-only browsing, while preserving radio
isolation and send gating. Do not simply remove the cleanup calls.

Retain position-specific source and timestamps when the protocol provides them;
contact activity must remain separate. Apple basemap tiles still depend on
available/cached map data; this work adds no offline tile download. Physical
radio, reconnect/background, VoiceOver traversal, landscape, and Mac visual QA
remain unverified. All work is local and uncommitted; nothing was deployed.
