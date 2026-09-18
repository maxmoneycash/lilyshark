# Message delivery and actions — September 15, 2026

This pass makes a message's status explainable from the conversation. It follows
the [MeshCore product direction](strategy/meshcore-app-direction-2026-09-14.md).
Changes are local; no release or physical-device installation was made.

## User-facing changes

| Before | After | What this changes |
| --- | --- | --- |
| Small status icons require protocol knowledge. | Tappable status opens a plain-language explanation and the available message evidence. | A person can distinguish a send request, radio acceptance, and recipient acknowledgement. |
| Channel traffic could display as a confirmed repeat. | “Radio activity” explains that the traffic was not matched to this message. | Nearby traffic no longer looks like proof of delivery. |
| Direct, room, and Meshtastic sends use similar status language. | Direct recipient, room server, and local-radio reports have distinct explanations. | The UI does not imply a read receipt or confirmation from every listener. |
| Failure offers a retry with little context. | Details show the reported reason, explain possible duplicates, disable retry while offline, and update during retry. | A retry has a clear result without dismissing and reopening the sheet. |
| Message actions depend on a long press that can open the text-selection menu. | An explicit Message actions menu exposes the existing actions and Details. | Quote, copy, forward, and applicable reactions are discoverable without relying on that gesture. |
| Quoting a message lets the preview's decorative rule expand over the history. | The rule is an overlay sized by the preview text and controls. | Choosing Quote keeps the conversation visible above the composer. |
| Time and delivery text compete for space at accessibility sizes; Today can break into two words. | Outgoing metadata stacks at accessibility sizes and the date takes priority over divider lines. | The status remains readable and tappable. |
| The offline composer action occupies several lines at large text sizes. | A shorter Connect radio action and bounded composer leave more room for the conversation. | Saved history is easier to read while disconnected. |

## Evidence rules

The projection is in
[MessageDeliveryEvidence.swift](../ios/Packages/MeshCoreKit/Sources/MeshCoreKit/Models/MessageDeliveryEvidence.swift).
It follows the actual retained state in
[MessageStoreManager.swift](../ios/Shared/Stores/MessageStoreManager.swift):

- MeshCore direct/room `.sent` follows `handleSentResponse`. It means the local
  radio accepted the request, not that the recipient acknowledged it.
- MeshCore channel `.sent` is assigned before a response. It is displayed as
  **Send requested**, not accepted or delivered.
- `handleSendConfirmed` correlates an acknowledgement with a pending send.
  Only direct/room `.delivered` exposes its acknowledgement round-trip value.
  An expected acknowledgement code or a stale round-trip value is not evidence.
- Meshtastic `.sent` follows the deck's routing result. It does not establish a
  recipient acknowledgement.
- Legacy `.repeated` can be produced by **any** `LOG_RX_DATA` within 30 seconds
  of a channel send. The stored enum is retained for compatibility; UI and debug
  logging describe unmatched radio activity instead of a confirmed repeat.
- `attempt` resets between retry phases. It is deliberately not displayed as a
  total transmission count. `didResetPath` is shown only as a route request.
- Incoming zero hops and zero SNR remain valid values; unknown/missing values
  stay unknown. No current contact path is presented as historical evidence.

The sheet re-reads the message while open. Retry requires a current failed
outgoing message, the same radio context, an available recipient where needed,
and a send-capable connection. A removed message or changed radio leaves saved
details readable and removes retry. The retry engine itself is unchanged.

## Simulator checks

Argent was used on iPhone 17e, iOS 26.5, 390 × 844 points, device
`9DF35957-E4CC-4D69-AC93-3D0CEE0DF7A0`. The isolated bundle is
`com.lilyshark.analyzerqa`; the real app's pairing and history are preserved.

The debug-only MeshFixtureHost's Message delivery scenario uses the real retry,
sent-response, and acknowledgement handlers with simulated responses. It creates
no connection coordinator and cannot send to a radio.

- [Unconfirmed message](qa/message-delivery-2026-09-15/01-unconfirmed.png): failure reason and explicit retry.
- [Retry result](qa/message-delivery-2026-09-15/02-retry-acknowledged.png): the open sheet updates after a simulated acknowledgement; retry disappears and 1250 ms appears.
- [Radio accepted](qa/message-delivery-2026-09-15/03-radio-accepted.png): no acknowledgement or round-trip claim despite an expected ACK code.
- [Channel activity](qa/message-delivery-2026-09-15/04-channel-activity.png): no confirmed-repeat claim.
- [Channel request](qa/message-delivery-2026-09-15/05-channel-send-requested.png): no radio-acceptance claim.
- [Room acknowledgement](qa/message-delivery-2026-09-15/06-room-acknowledged.png): server acknowledgement, 800 ms, and explicit member/read-receipt limits.
- [Offline retry](qa/message-delivery-2026-09-15/07-offline-retry.png): native accessibility inspection reports Retry message as disabled; copy remains enabled.
- [Meshtastic send](qa/message-delivery-2026-09-15/08-meshtastic-send.png): local radio report, no recipient acknowledgement.

- [Message actions](qa/message-delivery-2026-09-15/11-message-actions.png): opens from an incoming message; direct, channel, and room menus all reach Details.
- [Incoming details](qa/message-delivery-2026-09-15/12-incoming-details-large.png): received state, no retry, and unknown hops remain unknown.
- [Copy feedback](qa/message-delivery-2026-09-15/13-copy-confirmation-large.png): Copy message changes to Copied; selectable message text remains available.
- [Quote](qa/message-delivery-2026-09-15/14-quote-action.png): preview stays above the composer without covering history; removal works.
- [Forward](qa/message-delivery-2026-09-15/18-forward-picker.png): opens the existing destination picker; Cancel returns to the conversation.
- [Largest text, offline](qa/message-delivery-2026-09-15/09-largest-chat.png) and [scrolled metadata](qa/message-delivery-2026-09-15/19-largest-message-status.png): Today stays intact; the delivery label and actions are readable and reachable; the offline action is shorter.
- Accessibility3 sheet: [failure](qa/message-delivery-2026-09-15/10-accessibility-details.png), [retry control](qa/message-delivery-2026-09-15/15-accessibility-retry.png), [recorded values](qa/message-delivery-2026-09-15/16-accessibility-recorded-details.png), and [acknowledged result](qa/message-delivery-2026-09-15/17-accessibility-acknowledged.png) remain readable through scrolling. The acknowledgement updated while the sheet remained open.

The fixture's Largest text switch applies accessibility5 to pushed content; it
does not establish the size of presented sheets. Sheet checks used the separate
`LILYSHARK_UI_LARGE_TYPE` build flag, which applies accessibility3 at the sheet's
theme boundary. The final installed QA build and fixture text setting were
restored to standard text. System text-size settings were not changed.

Long press still competes with native text selection. The explicit action menu
is the verified route; this report does not claim that gesture was repaired.

## Automated checks

Seven new evidence tests plus the existing persistence and text-budget tests:
**14 passed, zero failures**. Coverage includes expected-versus-observed ACK,
stale RTT, transport/conversation differences, unmatched activity, failed-only
retry, zero reception values, and unknown/missing data.

```sh
/usr/bin/arch -arm64 /usr/bin/swift test \
  --package-path ios/Packages/MeshCoreKit \
  --filter 'MessageDeliveryEvidenceTests|MessagePersistenceTests|MessageTextBudgetTests'
```

Final normal iOS Simulator and macOS Debug builds pass. The standard fixture
build passes; the separate accessibility fixture also built and ran successfully.
The final source checks pass: 115 registered Swift files, 114 design-checked
files, 33 sheet-chrome checks, and `git diff --check`.

Build logs: `/tmp/lilyshark-delivery-ios-build.log`,
`/tmp/lilyshark-delivery-macos-build.log`,
`/tmp/lilyshark-delivery-fixture-build.log`, and
`/tmp/lilyshark-delivery-large-build.log`. Test log:
`/tmp/lilyshark-delivery-tests.log`.

## Limits and next work

This is simulator UI evidence with simulated radio responses, not physical RF
delivery evidence. Physical iPhone/radio sends, room authentication, interrupted
retry, background recovery, and late/duplicate ACK handling still need a device
pass. The current engine removes pending ACK correlation on timeout; this pass
does not fix late acknowledgements. It also does not add a persisted attempt
timeline, matched channel-repeat detection, or a recorded per-message route.

Next: connect node selection, reported position and its age/source, conversation,
and return-to-map behavior. Finish missing/stale/offline location states before
adding more tool categories. See the product direction's map acceptance criteria.
