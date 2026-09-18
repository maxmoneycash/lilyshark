# MeshCore daily-use pass — September 14, 2026

The user asked for a better experience after connecting and a concrete direction
for making Lilyshark a leading MeshCore app. No further hardware questions were
asked. The [product direction](strategy/meshcore-app-direction-2026-09-14.md)
sets the implementation order and release criteria.

## Changes

- The iPhone inbox contains people and rooms with messages, drafts, or an active
  compose destination. Conversations sort by message time rather than advert
  time. Channels stay first; unread and favourite filters live in the toolbar,
  and the title identifies the active filter.
- Draft text is the conversation preview. Conversation icons no longer imply
  online presence. Names and metadata stack at accessibility text sizes; message
  dates distinguish older messages from today's times.
- Compose separates channels, people, and rooms. Entire rows respond to taps,
  including short names such as Public and Trail room.
- Manage contacts retains the existing contact book, groups, import and editing
  controls. Repeater destinations open in that context, outside the inbox.
- Nodes has role filters with full-row controls. Node rows identify their roles
  and call MeshCore timestamps advertisements rather than current presence.
- Message, Open room, Manage repeater, and sensor telemetry actions appear near
  the top of node details. Missing position is compact. MeshCore records do not
  show an empty table of Meshtastic-only reception fields. Browsing a node no
  longer automatically requests status.
- Radio presents connected MeshCore monitoring tools first. Capture inspection
  remains available under Explore, alongside the original T-Deck tour.
- Room and repeater login forms scroll at large text sizes and use the shared
  primary button style. Room copy does not promise posting permission.
- A locked room retains unread messages. Its login screen does not register as
  the visible message history; read marking resumes when that history is shown.

## Simulator checks

Argent, iPhone 17e, iOS 26.5, 390 × 844 points. The isolated app is
`com.lilyshark.analyzerqa`; the real app and its pairing data were not reinstalled.
Fixtures use sample stores and simulated connection/session state, with no
coordinator or live radio commands. These are one-off interaction checks, not
saved automated regression tests.

| Check | Result |
| --- | --- |
| Inbox order differs from node advert order | Passed: Sam's newer message precedes Alex, while Nodes lists Alex's newer advert first. |
| Infrastructure and unused contacts stay out of inbox | Passed: repeater, sensor, and Casey with no history/draft absent; room history and Jordan's draft present. |
| Unread filter | Passed: read conversations and channels excluded; title reads Unread. |
| Compose new recipient from Unread | Passed: Casey opens despite having no history or unread messages. |
| Compose a read channel from Unread | Passed: Public opens while excluded by the current filter. |
| Entire compose row hit area | Reproduced missed taps on Public and Trail room; both passed at the row center after the fix. |
| Draft restoration | Passed: Casey's typed `Meet at the creek.` survived leaving and reopening; Jordan's seeded draft appears in both row and composer. No send attempted. |
| Repeater role filter → details → Manage repeater | Passed: only the repeater remains; management reaches the existing login view; back leads to Contacts, then Messages. |
| Sensor role filter → details | Passed: sensor identified, Request telemetry visible near the top, no message action. |
| No automatic node request | Passed: opening repeater/sensor details shows saved information without starting a request countdown. |
| Room entry | Passed: compose opens the named room's login screen. Authentication was not attempted. |
| Room unread state | Passed: opening and reopening login retains 1 unread for Trail room (3 total). Explicitly simulating session access shows its sample history and clears only that room's unread (2 total); returning to the inbox confirms the room has no unread badge. |
| Known nodes with no conversations | Passed: channels and compose remain available; inbox explains where future conversations and drafts appear. |
| Saved data offline | Passed: saved reports/messages remain; radio is labelled offline and sending requires reconnection. |
| Meshtastic sample scenario | Passed: Primary naming, conversation order, and MeshCore-only control gating preserved. |
| Accessibility text | Inbox names/metadata wrap; Radio stays readable; room and repeater login can scroll to Log in at accessibility5. Normal text restored afterward. |

## Evidence

- [Inbox](qa/meshcore-ux-2026-09-14/inbox.png),
  [unread](qa/meshcore-ux-2026-09-14/unread-inbox.png),
  [draft preview](qa/meshcore-ux-2026-09-14/draft-inbox.png),
  [empty inbox](qa/meshcore-ux-2026-09-14/empty-inbox.png).
- [Compose](qa/meshcore-ux-2026-09-14/compose.png),
  [repeater action](qa/meshcore-ux-2026-09-14/repeater-details.png),
  [sensor action](qa/meshcore-ux-2026-09-14/sensor-details.png).
- [Room entry](qa/meshcore-ux-2026-09-14/room-entry.png),
  [room history after simulated access](qa/meshcore-ux-2026-09-14/room-history-simulated.png),
  [repeater entry](qa/meshcore-ux-2026-09-14/repeater-entry.png),
  [Radio](qa/meshcore-ux-2026-09-14/radio.png),
  [offline](qa/meshcore-ux-2026-09-14/offline.png).
- [Largest-text inbox](qa/meshcore-ux-2026-09-14/inbox-largest-text.png),
  [room login](qa/meshcore-ux-2026-09-14/room-largest-text.png),
  [repeater login](qa/meshcore-ux-2026-09-14/repeater-largest-text.png).

## Build and reproducibility

Final normal unsigned iOS Simulator and macOS builds, the isolated fixture build,
source registration (114 Swift files), design checks, sheet chrome checks and
`git diff --check` passed. Final build logs:

- `/tmp/lilyshark-meshcore-ui-build.log`
- `/tmp/lilyshark-meshcore-macos-build.log`
- `/tmp/lilyshark-meshcore-fixture-build.log`

The fixture requires **all three** compilation conditions: `DEBUG`,
`LILYSHARK_UI_CHAT_FIXTURE`, and `LILYSHARK_UI_MESH_FIXTURE`. The chat fixture
condition enables the existing persistence isolation. Scenarios include MeshCore
people/repeater/room/sensor, Meshtastic, empty, nodes without conversations,
offline, accessibility text, and explicitly simulated room access.

## Limits and next work

Changes are local and uncommitted. Nothing was installed on the physical iPhone
or published. Radio delivery, real room/repeater authentication, persistent draft
storage across process launches, and background recovery still need physical
validation. UI-fixture state changes do not establish any of those results.

Next: implement message delivery details using actual message evidence, followed
by the connected node/map/offline flow in the product plan. Login helper content
and empty telemetry panels still offer opportunities to simplify the interface;
this pass makes their actions reachable rather than claiming all UI is finished.
