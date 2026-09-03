# Wiring MeshtasticKit into PommeCore

This package lets the vendored app talk to a Lilyshark deck. The deck presents
Meshtastic's client GATT service, not the Nordic UART service MeshCore uses, so
the transport is a second CoreBluetooth central sitting beside
`MeshCoreKit.BLEManager` rather than a new mode inside it.

This file was written as a set of instructions before the app side existed. The
app side now exists, so it is a record of **where the wiring lives** and **what
is still missing**, not a plan. Nothing here has run against a radio — see
**Not verified**.

---

## 1. What the package provides

`BLE/MeshtasticBLEManager.swift` — a `CBCentralManager` that:

- scans filtered to `6BA1B218-15A8-461F-9FA8-5DCAE273EAFD`, so only Meshtastic
  radios appear;
- connects, discovers ToRadio / FromRadio / FromNum, subscribes to FromNum;
- **drains** FromRadio: reads it over and over until a read returns zero bytes,
  publishing every non-empty payload to `fromRadioSubject` in queue order;
- re-drains on every FromNum notification, after every successful ToRadio write,
  once on subscription, and on a 30 s backstop timer (`backstopDrainInterval`);
- serialises ToRadio writes through `send(toRadio:) -> Bool`, one protobuf per
  ATT write, `.withResponse`;
- auto-reconnects an unexpected disconnect, with a 60 s watchdog that falls back
  to scanning so a switched-off deck does not leave the UI hanging;
- restores state after an iOS background relaunch
  (`CBCentralManagerRestoreIdentifierKey`, restore id distinct from MeshCore's).

Published state, all `@Published` on `ObservableObject`: `connectionState`,
`discoveredDevices`, `connectedDeviceName`, `isPoweredOn`, `statusMessage`,
`lastFromNum`, plus the `fromRadioSubject` passthrough.

`Protocol/MeshtasticProto.swift` — the codec. `encodeWantConfig(nonce:)`,
`encodeDisconnect()`, `encodeTextPacket(to:channel:packetID:text:wantAck:)`, and
`parseFromRadio(_:) -> FromRadio?` returning `.myInfo`, `.metadata`,
`.nodeInfo`, `.text`, `.position`, `.routing`, `.configComplete` or `.other`.
`nil` means malformed, which on this link is a symptom rather than noise (see
**Not verified** #4). Pure functions over `Data`, pinned by hand-computed vectors
shared with the firmware's `test/meshtastic_api` and the web client's
`meshtasticProto.test`.

`Bridge/MeshtasticIdentity.swift` — the one definition of how a 32-bit node
number is carried in the 32-byte key space the app's stores are built on:
`syntheticKey(forNodeNum:)`, `nodeNum(forSyntheticKey:)`,
`defaultLabel(forNodeNum:)`, and `snrQuarterDecibels(from:)`.

---

## 2. The one edit still outstanding

**The package is not in the Xcode project.** `ios/PommeCore.xcodeproj` and
`ios/project.yml` both still list `MeshCoreKit` alone, so nothing in the app can
import this package yet.

Every app-side call site is therefore written under `#if
canImport(MeshtasticKit)`. The app builds green either way, and with the package
absent the MeshCore path is byte-for-byte what it was.

To turn it on, add the package and depend on it from each app target:

```yaml
packages:
  MeshCoreKit:
    path: Packages/MeshCoreKit
  MeshtasticKit:
    path: Packages/MeshtasticKit
```

and under `dependencies:` for `PommeCore`, `PommeCore-macOS` and
`PommeCore-watchOS`:

```yaml
      - package: MeshtasticKit
```

`project.yml` is not what builds the app — the committed `PommeCore.xcodeproj`
is canonical and running `xcodegen` overwrites it destructively, see
`ios/BUILD.md`. So the real edit is to `project.pbxproj`: one
`XCLocalSwiftPackageReference` for `Packages/MeshtasticKit` registered in
`packageReferences`, and for each app target one
`XCSwiftPackageProductDependency`, one `PBXBuildFile`, an entry in the target's
`packageProductDependencies`, and an entry in its Frameworks build phase.

No new Info.plist keys are needed: the targets already declare the
`bluetooth-central` background mode and both Bluetooth usage strings, and a
second `CBCentralManager` in the same process needs neither.

---

## 3. Where the app-side wiring lives

`ios/Shared/Stores/ConnectionManager.swift`

- `enum Transport` gained `.meshtastic`, and `activeTransport` returns it first —
  a connected deck is an explicit operator choice and must not be shadowed by a
  stale WiFi session.
- `meshtasticManager`, `discoveredMeshtasticDevices` and `meshtasticState` are
  the deck's half of the store; `isMeshtasticReady` and `isMeshtasticLinkActive`
  are the plain booleans every transport decision reads, and both are false in a
  build without the package.
- `activateBluetooth()` creates both centrals, so one Bluetooth prompt covers
  both. `disconnectForTermination()` drops both links.
- `sendCommand` refuses loudly on a Meshtastic link. Unhandled it would fall
  through to `bleManager.send`, which drops the frame silently.
- `sendToRadio(_:label:)` is the Meshtastic send. It is deliberately not part of
  `sendCommand`: the bytes come from `MeshtasticProto`, not `MeshCoreProtocol`.
- `startScanning` / `stopScanning` / `handleScanTimeout` drive both centrals.
- `connectMeshtastic(to:)` connects through the right central. The two lists are
  never merged — they hold `CBPeripheral`s owned by different centrals.
- `disconnect()` writes `ToRadio{disconnect}` before dropping the link.
- `setupMeshtasticSubscriptions()` mirrors the deck's state into the single
  `connectionState` every screen reads, and `bridged(_:)` is the one place the
  two connection-state enums are equated.

`ios/Shared/ViewModels/PommeCoreViewModel.swift`

- `onDeviceReady()` asks a deck for its config dump instead of firing the twelve
  MeshCore settings commands, the contact sync and the message sync.
- `meshtasticConfigNonce` holds the outstanding request; `handleDisconnect`
  clears it.

`ios/Shared/ViewModels/PommeCoreViewModel+ResponseHandling.swift`

- `requestMeshtasticConfigDump()` and `handleFromRadioFrame(_:)`, plus the
  helpers that land each message in the stores the MeshCore path already fills:
  `ContactStore.handleAdvert` for nodes, `handleIncomingMessage` for texts,
  `MessageStoreManager.handleMeshtasticRouting` for send confirmation.

`ios/Shared/Stores/MessageStoreManager.swift`

- `sendTextMessage` and `sendChannelMessage` branch on `meshtasticNodeNum` and
  build a `ToRadio{packet}` instead of a MeshCore frame.
- `pendingMeshtasticPackets` is a separate waiting room from `pendingACKs`,
  because that table drives the MeshCore retry ladder, which on timeout rebuilds
  MeshCore frames.

`ios/Shared/Stores/ChannelStore.swift`

- `seedPrimaryChannelForDeck()` gives broadcast traffic a row in the UI. The
  deck's channel record carries only the default PSK and the PRIMARY role, so
  there is nothing for the sequential MeshCore channel sync to ask for.

`ios/Shared/Views/DeviceScannerView.swift`

- A second list, "Lilyshark Decks", with a footer saying plainly that the radio
  settings and management tools do not apply to one.

---

## 4. How a node becomes a contact

Meshtastic identifies a node by a 32-bit `num`; the app's stores key everything
by the first six bytes of a 32-byte public key. `MeshtasticIdentity` derives one
from the other: `4D 54` ("MT"), then the number big endian, then zero padding.
Unique per node, stable across reconnects, and recoverable from the six-byte
prefix alone — which is all a stored `Message` keeps, and therefore all a reply
typed into a conversation has to address the deck with.

Contacts are built with `type: .chat` (a deck reports no roles) and
`outPathLen: -1` (this API exposes none of Meshtastic's routing). Names and
positions arrive on different messages — a `node_info` in the dump, a
`POSITION_APP` packet afterwards, a text from a node that has announced nothing
at all — so the upsert carries forward whatever the new message does not know.

`MeshMapView` needs no change: it draws
`contactStore.contacts.filter { $0.latitude != 0 || $0.longitude != 0 }` and
`contactStore.positionTrail(for:)`, and both are filled by that upsert.

---

## 5. Not verified

Stated plainly, because each of these will otherwise be discovered as a bug.

1. **No radio has been on the other end.** CoreBluetooth has no headless
   simulator: a `CBCentralManager` on a build machine reports `.unsupported` and
   never scans, so none of the transport or the store wiring has been exercised
   against hardware. What is verified is that `MeshtasticProto` and
   `MeshtasticIdentity` produce and read the exact bytes the firmware does
   (`swift test`), and that the app compiles with the package linked. The first
   real check is a deck on a bench: watch for "Subscribed to FromNum", then a
   burst of `fromRadioSubject` events ending in `config_complete_id`, then a
   node list in the app.

2. **The deck acts on three ToRadio messages only.** `parseApiToRadio`
   (`src/core/meshtastic_api.cpp`) handles `want_config_id`, `disconnect`, and a
   `packet` carrying a text. Everything else — position from the phone, channel
   edits, config writes, admin messages, traceroute, telemetry — parses to
   `Kind::None` and is discarded **silently**. The app must not offer UI for them
   on a Meshtastic link.

3. **The config dump is deliberately thin.** `encodeApiConfigMessage` sends
   `my_info`, `metadata`, the node list, one primary channel with the default
   PSK, and a LoRa config hardcoded to preset LONG_FAST / region US / hop limit
   3. Battery, frequency, bandwidth, spreading factor, coding rate and TX power
   have no source at all, so the Settings screen shows a deck's defaults rather
   than its radio. Nothing should be written back.

4. **Long FromRadio payloads are corrupted by design of the pair.** The firmware
   pops a new protobuf on *every* read callback instead of serving offsets into
   the one already handed out. iOS negotiates ATT_MTU 185 by default, so anything
   over ~184 bytes makes CoreBluetooth issue a blob read and the continuation
   carries the *next* message's bytes: one packet arrives spliced, another
   disappears. Config-dump frames are all comfortably under this; a text near the
   237-byte Meshtastic limit is not. The manager logs an error when it sees a
   payload that cannot have fitted one read response — grep the log for
   "exceeds the" — and the app logs "unreadable FromRadio" when the splice
   reaches the parser. **The fix is firmware-side**: `FromRadioEvents::onRead`
   must use the `esp_ble_gatts_cb_param_t` overload and only pop when
   `param->read.offset == 0`, caching the message for the continuation reads.

5. **The node list is capped at nine.** `service_ble_api()` collects at most
   eight heard nodes plus self, and skips anything not heard on the Meshtastic
   protocol. The app's node list is a window, not the deck's full picture.

6. **The deck queue is eight deep, 512 bytes per message, and drops on full.**
   `queueBleFromRadio` returns false and live node/text/position frames are
   discarded when the phone is slow to read. This is why the manager drains
   eagerly rather than on a timer, and why the app writes a farewell on
   disconnect.

7. **A message is `.sent`, never `.delivered`.** The deck answers a packet
   carrying a non-zero id with a Routing result naming it
   (`encodeApiRoutingAck`), and that says its own radio transmitted — it is not
   Meshtastic's end-to-end acknowledgement, which this firmware does not relay.
   Claiming delivery would be a promise nobody made.

8. **No pairing/bonding on a deck.** `tdeck_ble.cpp` sets no security, so a deck
   connects with no PIN. Stock Meshtastic firmware *does* bond; pointing this
   manager at one surfaces a system pairing prompt, and a cancelled pairing
   arrives as an "Encryption is insufficient" error on the FromNum subscription.
   The manager stops auto-reconnecting on that error and clears the saved
   peripheral, so the prompt is not replayed — but there is no UI for entering a
   PIN, so a bonded radio is out of reach.

9. **watchOS is untested at any level.** The package declares watchOS 11 and the
   manager avoids UIKit, but no watch screen reaches a deck, and this machine has
   no watchOS runtime installed, so that target has not been compiled with the
   package linked.
