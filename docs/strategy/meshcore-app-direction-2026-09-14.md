# Lilyshark: the MeshCore app direction

September 14, 2026. Product decision and implementation order, grounded in the
current native code and published competitor capabilities. This is not a claim
that Lilyshark already outperforms those apps; competitor apps were not tested
hands-on during this pass.

## The experience to build

**Make Lilyshark the clearest way to communicate through and understand a
MeshCore network.** After connecting, a person should immediately know where to
talk, who their radio knows, what happened to a message, and what to do next.

Keep the light interface, pink accent, native iPhone controls, and original
interactive T-Deck tour. Give content and actions priority over decorative
panels, repeated status summaries, and empty charts. Put technical detail one
step from the conversation or node it explains.

## What the competitive baseline tells us

The official app's release notes include channel settings, message retention,
navigation to unread messages, composer focus options, and path-trace updates.
These are reminders that daily messaging and protocol maintenance both matter.
[Official MeshCore app](https://apps.apple.com/us/app/meshcore/id6742354151).

MeshCore One declares DMs with delivery tracking, channels and rooms, message
paths, offline maps, terrain analysis, telemetry, RX logging, noise monitoring,
and remote administration. A list of comparable tools is already expected in
this category. [MeshCore One feature list](https://github.com/Avi0n/MeshCoreOne).

Our opportunity is a product judgment: connect those capabilities into coherent
jobs. Lilyshark already has conversations, node tools, maps, terrain planning,
and capture inspection. Too many of their entry points have felt like separate
utilities. Finish the connections between them and verify their real results.

## Screen responsibilities

- **Mesh:** orient yourself; open recent conversations, browse known nodes, or
  open reported positions. Saved information remains useful while offline.
- **Messages:** conversations and channels, newest activity first, with drafts,
  unread state, search, and reliable return navigation.
- **Nodes:** a directory of people, repeaters, rooms, and sensors. Actions follow
  the node's role. A saved advertisement never means someone is online now.
- **Map:** understand reported locations and explore a selected node or path.
  Keep local radio observations distinct from community coverage.
- **Radio:** supported live tools first, then planning and saved capture analysis.
  Keep demonstrations explicitly under Explore.
- **Settings:** personal preferences, radio configuration, and advanced setup.

## Implementation order and acceptance criteria

### 1. Finish the everyday message and node loop — this pass

| Before | After | What this changes |
| --- | --- | --- |
| Messages uses `sortedContacts(byLastSeen:)`, mixing repeaters and sensors with people. | iPhone inbox contains people/rooms with history, drafts, or an active compose destination; sorted by latest message. | Finding an active conversation no longer depends on advertisement order. |
| A draft displays a small marker beside the previous message or last-seen text. | The row previews the draft text. | Returning to unfinished writing is recognizable. |
| One compose section calls people and rooms “Direct messages.” | Separate Direct messages and Rooms sections. | The destination is clear before entering it. |
| Short compose rows respond only near their text. | The full row is tappable. | A tap on Public or a room opens it consistently. |
| Nodes has search but no role filter. | All nodes, People, Repeaters, Rooms, and Sensors filters. | Users can find a person to message or infrastructure to inspect. |
| Node actions sit below reception fields and a large missing-position panel. | Role-specific action follows the identity; missing positions take one line. | The first screen offers a useful next step. |
| Opening infrastructure automatically requests status. | Requests are explicit actions. | Browsing saved information does not start an unexplained countdown or use radio airtime. |
| Radio leads with opening a saved capture. | Connected MeshCore monitoring tools lead; capture analysis stays under Explore. | The first choices apply to the radio in use. |
| Login controls overflow at large text sizes; entering a locked room marks history read. | Scrollable forms with shared button styling; only visible authenticated history clears unread. | Room and repeater entry stay usable without losing unread information. |

Keep the existing contact-book/group tools under **Messages → More → Manage
contacts**. Do not destroy group membership or conversation history to simplify
the inbox. The implementation and its simulator evidence are tracked in
[the QA report](../meshcore-ux-qa-2026-09-14.md).

### 2. Make delivery understandable — UI implemented September 15

Message status and an explicit message-action menu now open Details. The sheet
explains radio acceptance, recipient or room-server acknowledgement, reported
failure, retry, and saved reception values. It updates during an active retry.
Copy, quote, forward, and applicable reactions have a visible menu entry point.
See the [implementation and simulator evidence](../message-delivery-qa-2026-09-15.md).

Source inspection changed two assumptions in the original plan: the attempt
counter resets between phases, so it is not a total transmission count; the
legacy channel “repeated” state comes from unmatched nearby RX activity. The UI
now describes that activity without claiming a confirmed repeat. Expected ACK
codes and stale round-trip values are not treated as delivery evidence.

Seven evidence tests and the existing persistence/text-budget tests pass. The
simulator verifies live sheet updates, offline retry gating, message actions,
and accessibility layouts. No current node path is drawn as a message's route.

Remaining delivery-engine acceptance: late and duplicate acknowledgements,
timeout/refusal and interrupted retry on real radios, background recovery, and
matched channel-repeat evidence. Pending ACK correlation currently ends on
timeout; the UI pass does not resolve late ACK handling. Keep this physical and
protocol validation distinct from the completed presentation work.

### 3. Make the map useful during a trip — navigation implemented September 15

The node → map → conversation → return loop is implemented, with missing-position
actions, explicit internet layers, and honest unknown fix time/accuracy. See
[the implementation and QA](../node-map-qa-2026-09-15.md). The next step is real
per-radio retention after disconnect: active stores currently clear, unlike the
offline UI fixture. Position-specific metadata and offline basemap preparation
remain separate work.


Connect node selection, reported position, conversation, and terrain planning.
Show report age and source next to the selected location. Distinguish observed
paths from planned paths and uncertain hash matches. Finish offline preparation
as one flow with saved area, storage size, progress, and a usable offline check.

Acceptance: choose a node, inspect its reported location, message it, and return
to the same map context. Repeat with phone location denied, no internet, stale
reports, and no position. Do not invent topology from geographic proximity.

### 4. Turn radio analysis into Lilyshark's distinguishing experience

Connect a node or delivery problem to the relevant observations and supported
tools. A useful result explains the evidence and offers a specific next action:
inspect the saved path, request fresh telemetry, run a deliberate trace, or view
captured traffic when the transport supports it. Keep raw bytes available for
people who need them. Do not promote imported/sample data to live RF evidence.

Acceptance: every advertised live tool has a tested supported-radio path, bounded
waiting, cancellation, understandable failure, and a result that survives
navigation where appropriate. iPhone live analyzer transport is still a separate
unfinished dependency; the current capture importer does not satisfy that gate.

## How we judge progress

For each release candidate, run the same tasks: start a public conversation;
find and message someone new; return to a draft; understand an unconfirmed send;
open a room; inspect a repeater; find a sensor reading; find a reported location.
Count successful completions, accidental navigation, lost text, misleading
states, and unexplained waits. Compare competitors on these same tasks with the
same radios and network conditions before making superiority claims.

Simulator fixtures cover populated, empty, offline, large-text, and long-name
screens. Physical iPhone/radio checks must establish message delivery, room and
repeater authentication, background/foreground recovery, notification routing,
and interrupted operations. Compile success and attractive screenshots cannot
substitute for those checks.

The next milestone is a complete, trustworthy daily-use loop. Defer additional
feature categories until the flows above are demonstrably usable.
