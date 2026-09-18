# Connected iPhone experience — September 14, 2026

The user redirected this pass to what the app lets people do **after connecting**:
the interface, useful actions, and navigation. Connection troubleshooting is not
the focus of this change. Changes are local and uncommitted.

## Result

- **Mesh** is the iPhone's starting tab. It shows the radio's name and reported
  battery state, known nodes, reported positions, a primary-channel action, recent
  conversations and unread counts, and the latest node reports.
- **Nodes** has name/node-ID search, report age, available signal readings and
  MQTT provenance. Node details lead into the existing direct-message or room
  route. Counts exclude blocked nodes and the radio itself. Missing readings
  remain absent; saved nodes are not described as currently in range.
- **Messages** has a clear title and a compose sheet for choosing a channel or
  contact. Channels default to the top, with an existing explicit ordering
  preference preserved. Contact actions are collected in one menu. Primary
  channel names match across the overview, list, and conversation.
- Tabs remain available in conversations. Channel and room titles use compact
  navigation chrome. Returning to the list and reopening a conversation works;
  initial selection is synchronized once, without reapplying it on every return.
- **Map** starts on My mesh. Opening reported positions from Mesh selects that
  source even if the user previously viewed community coverage.
- **Radio** leads with traffic analysis, followed by link-planning tools and
  exploration. The existing handset tour is preserved under Explore. Live
  MeshCore tools appear when supported; otherwise an expandable explanation
  describes their requirements. Meshtastic connections no longer expose
  MeshCore channel-creation and discovery actions in the message-list controls.
- Unread badges retain their width, and overview names/unread counts stack at
  accessibility text sizes.

The disconnected welcome and original interactive handset tour remain in the app.

## Screenshots

Screenshots show an isolated UI fixture with **sample data**, not a physical-radio
session. The banner is compiled only into this fixture.

| Screen | Evidence |
| --- | --- |
| Previous connected landing screen | [Before](qa/connected-ui-2026-09-14/before-connected.png) |
| Mesh overview | [Populated](qa/connected-ui-2026-09-14/mesh-overview.png), [empty](qa/connected-ui-2026-09-14/mesh-empty.png) |
| Node directory | [Nodes](qa/connected-ui-2026-09-14/nodes.png) |
| Messages and compose | [Messages](qa/connected-ui-2026-09-14/messages.png), [compose](qa/connected-ui-2026-09-14/compose.png) |
| Radio tools | [Radio](qa/connected-ui-2026-09-14/radio.png) |
| Accessibility text | [Largest-text conversation preview](qa/connected-ui-2026-09-14/mesh-largest-text.png) |

## Validation

Argent on iPhone 17e / iOS 26.5, 390 × 844 points, light appearance:

| Check | Result |
| --- | --- |
| Mesh primary action opens Primary on the Messages tab | Passed; one compact channel title |
| Back returns to Messages with working tabs | Passed |
| Nodes → details → Message opens the selected person | Passed |
| Compose → existing person, including reopening the same conversation | Passed |
| Draft survives leaving and reopening via Compose | Passed with `Meet at the trail junction.`; no send attempted |
| Search `!00f17a02` in Nodes | Matched only Sam's sample node |
| Report with no signal/position but MQTT provenance | Shows MQTT without inventing readings or a position |
| Mesh → map | My mesh selected; both reported sample positions available, including with phone location permission denied |
| Radio → Traffic Analyzer → Done | Passed |
| Empty connected mesh | Useful channel action remains; node directory explains the empty state |
| Saved data while offline | Reports and conversations remain browseable; radio shown offline |
| Standard and largest accessibility text | Inspected Mesh, node reports and Radio; fixed compressed overview headings and unread badges |
| Message-list channel unread badge | Visible count confirmed after width fix |

Build/check results for the final source:

- Normal unsigned iOS Simulator `PommeCore` build: **passed**.
- Normal unsigned `PommeCore-macOS` build: **passed**.
- Isolated UI-fixture build: **passed**.
- `python3 scripts/add_ios_source.py --check`: **114 registered Swift files**.
- `python3 scripts/check_ios_design.py`: **passed**.
- `python3 scripts/check_sheet_chrome.py`: **passed**.
- `git diff --check`: **passed**.

Logs: `/tmp/lilyshark-mesh-ui-build.log`, `/tmp/lilyshark-mesh-macos-build.log`,
and `/tmp/lilyshark-mesh-fixture-build.log`.

## Fixture and limits

`MeshFixtureHost.swift` uses the existing `LILYSHARK_UI_CHAT_FIXTURE` isolation
guards plus `LILYSHARK_UI_MESH_FIXTURE`. Both flags and DEBUG are required. The
fixture creates no production coordinator and does not activate a Bluetooth
transport. Contacts, reports, messages and drafts are session data. Commands are
not connected to a radio. A separate bundle, `com.lilyshark.analyzerqa`, was
installed on the dedicated simulator; the real app's installation was preserved.

Build the fixture with:

```sh
/usr/bin/arch -arm64 /usr/bin/xcodebuild \
  -project ios/PommeCore.xcodeproj -scheme PommeCore \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/lilyshark-mesh-fixture-derived \
  -configuration Debug CODE_SIGNING_ALLOWED=NO \
  'SWIFT_ACTIVE_COMPILATION_CONDITIONS=$(inherited) DEBUG LILYSHARK_UI_CHAT_FIXTURE LILYSHARK_UI_MESH_FIXTURE' build
```

Physical iPhone/radio validation and installing this build on the user's phone
remain outstanding. This pass does not establish transport reliability,
over-the-air delivery, or release readiness. iPad, Mac visual QA, dark appearance,
and a full VoiceOver walkthrough were not completed in this pass.
