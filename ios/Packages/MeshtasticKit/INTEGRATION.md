# Wiring MeshtasticKit into PommeCore

This package lets the vendored app talk to a Lilyshark deck. The deck presents
Meshtastic's client GATT service, not the Nordic UART service MeshCore uses, so
the transport is a second CoreBluetooth central sitting beside
`MeshCoreKit.BLEManager` rather than a new mode inside it.

Everything below names a real file, a real symbol and a real line of behaviour.
Nothing here has run against a radio — see **Not wired yet**.

---

## 1. What this package already gives you

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

Published state, all `@Published` on `ObservableObject`, same shape as
`BLEManager`:

| Member | Type |
| --- | --- |
| `connectionState` | `MeshtasticBLEConnectionState` (`.disconnected/.scanning/.connecting/.connected/.ready`) |
| `discoveredDevices` | `[DiscoveredMeshtasticDevice]` |
| `connectedDeviceName` | `String?` |
| `isPoweredOn` | `Bool` |
| `statusMessage` | `String?` |
| `lastFromNum` | `UInt32` (diagnostic only) |
| `fromRadioSubject` | `PassthroughSubject<Data, Never>` |

`fromRadioSubject` emits **raw FromRadio protobuf bytes**. This package does not
decode them. `.receive(on: DispatchQueue.main)` before touching any store —
events arrive on the BLE queue.

`MeshtasticBLEConnectionState` maps one-to-one onto
`MeshCoreKit.BLEConnectionState`, which is what lets the existing UI keep
working. Write the mapping once, in `ConnectionManager`:

```swift
private static func bridged(_ state: MeshtasticBLEConnectionState) -> BLEConnectionState {
    switch state {
    case .disconnected: return .disconnected
    case .scanning:     return .scanning
    case .connecting:   return .connecting
    case .connected:    return .connected
    case .ready:        return .ready
    }
}
```

---

## 2. Build-system wiring

`ios/project.yml` — add the package and depend on it from each app target that
should see a deck:

```yaml
packages:
  MeshCoreKit:
    path: Packages/MeshCoreKit
  MeshtasticKit:
    path: Packages/MeshtasticKit
```

and under `targets: PommeCore: dependencies:` (and `PommeCore-macOS`, and
`PommeCore-watchOS` if the watch is ever pointed at a deck):

```yaml
    dependencies:
      - package: MeshCoreKit
      - package: MeshtasticKit
```

Then regenerate with `xcodegen` (see `ios/scripts/`). No new Info.plist keys: the
targets already declare `bluetooth-central` background mode and both Bluetooth
usage strings, and a second `CBCentralManager` in the same process needs neither.

**If the protocol-layer agent already created `Package.swift`**, keep theirs and
make sure the `BLE` directory is compiled. If their target uses
`path: "Sources/MeshtasticKit"`, either move `BLE/` under that path or change the
target to `path: ".", sources: ["BLE", "Sources"]`. A directory SwiftPM is not
told about is silently not built, and the failure looks like "MeshtasticBLEManager
is not a known type" rather than a missing file.

---

## 3. `ConnectionManager` — the specific edits

File: **`ios/Shared/Stores/ConnectionManager.swift`**

### 3.1 The enum

Line 20 today:

```swift
enum Transport { case ble, usb, wifi }
```

becomes:

```swift
/// `.ble` is MeshCore over Nordic UART; `.meshtastic` is a Lilyshark deck over
/// Meshtastic's client service. They are different protocols end to end, not
/// two dialects of one, so a frame built for one is never valid on the other.
enum Transport { case ble, usb, wifi, meshtastic }
```

Add `import MeshtasticKit` beside the existing `import MeshCoreKit`.

### 3.2 The manager

Beside `let bleManager = BLEManager()` (line 94):

```swift
let meshtasticManager = MeshtasticBLEManager()
```

Call `meshtasticManager.activate()` wherever `bleManager.activate()` is called
today (`PommeCoreApp` / onboarding completion — grep for `bleManager.activate`),
so the second Bluetooth permission prompt does not fire during onboarding.

### 3.3 `activeTransport` and `isActivelyConnected`

`activeTransport` (line 84) is derived from the same priority order as
`sendCommand`. Meshtastic goes **first**, because a connected deck is an explicit
operator choice and must not be shadowed by a stale WiFi session:

```swift
var activeTransport: Transport {
    if meshtasticState == .ready { return .meshtastic }
    if wifiManager.isConnected { return .wifi }
    #if os(macOS) || targetEnvironment(macCatalyst)
    if usbManager.isConnected && usbManager.detectedMode == .binary { return .usb }
    #endif
    return .ble
}
```

where `meshtasticState` is a new mirrored property (see 3.5). Add the same clause
to `isActivelyConnected` (line 74).

### 3.4 Sending

`sendCommand(_:label:)` (line 147) builds and routes **MeshCore binary frames**.
A deck cannot parse one. Today an unmodified `sendCommand` on a Meshtastic link
falls through to `bleManager.send(data:)`, which drops the frame because there is
no RX characteristic — a silent no-op that will read as "the app is broken".
Make it loud instead, as the first clause of the method:

```swift
if activeTransport == .meshtastic {
    Self.logger.warning("Refusing \(label) — MeshCore frames are not valid on a Meshtastic deck")
    DebugLogger.shared.log("TX BLOCKED \(label) — deck speaks Meshtastic", level: .error)
    return
}
```

Add the Meshtastic path as its own method — it takes an already-encoded
`ToRadio` protobuf, so it must not be confused with `sendCommand`:

```swift
/// Send one encoded ToRadio protobuf to a connected deck. The bytes come from
/// the protocol layer; this only routes them.
@discardableResult
func sendToRadio(_ data: Data, label: String) -> Bool {
    guard meshtasticState == .ready else {
        Self.logger.warning("Cannot send \(label) — no deck connected")
        return false
    }
    Self.logger.info("TX(Meshtastic) \(label) [\(data.count) bytes]")
    DebugLogger.shared.log("TX(MT) \(label) [\(data.count)B]", level: .tx)
    return meshtasticManager.send(toRadio: data)
}
```

### 3.5 Subscriptions

In `setupSubscriptions()` (line 725), beside the `bleManager` blocks. Add a
stored `private(set) var meshtasticState: MeshtasticBLEConnectionState = .disconnected`
and a `var onToRadioFrameReceived: ((Data) -> Void)?` callback next to the
existing `onFrameReceived` (line 111) — a separate callback, because the payload
is a protobuf and `PommeCoreViewModel.handleReceivedData` hands its argument to
`MeshCoreKit.FrameParser`.

```swift
meshtasticManager.fromRadioSubject
    .receive(on: DispatchQueue.main)
    .sink { [weak self] data in
        self?.onToRadioFrameReceived?(data)
    }
    .store(in: &cancellables)

meshtasticManager.$discoveredDevices
    .receive(on: DispatchQueue.main)
    .sink { [weak self] devices in
        self?.discoveredMeshtasticDevices = devices
    }
    .store(in: &cancellables)

meshtasticManager.$connectionState
    .receive(on: DispatchQueue.main)
    .sink { [weak self] state in
        guard let self else { return }
        self.meshtasticState = state
        // A MeshCore radio and a deck are never connected at once; whichever
        // link is live owns the single connectionState the UI reads.
        guard self.connectionState == .disconnected || self.activeTransport == .meshtastic else { return }
        let previous = self.connectionState
        self.connectionState = Self.bridged(state)
        if state == .disconnected { self.onDisconnected?(previous) }
        if state == .ready && previous != .ready { self.onDeviceReady?() }
    }
    .store(in: &cancellables)

meshtasticManager.$connectedDeviceName
    .receive(on: DispatchQueue.main)
    .sink { [weak self] name in
        guard let self, self.activeTransport == .meshtastic else { return }
        self.connectedDeviceName = name
    }
    .store(in: &cancellables)

meshtasticManager.$statusMessage
    .receive(on: DispatchQueue.main)
    .sink { [weak self] message in
        guard let message else { return }
        self?.bleStatusMessage = message
    }
    .store(in: &cancellables)
```

### 3.6 Scan, connect, disconnect

`startScanning()` (line 504) and `stopScanning()` (line 515) should drive both
centrals — the operator does not know which protocol their radio speaks until
they see it in the list:

```swift
func startScanning() {
    guard bleManager.isPoweredOn else { pendingAutoScan = true; return }
    scanRetryTask?.cancel()
    isScanning = true
    bleManager.startScanning()
    meshtasticManager.startScanning()
}
```

`handleScanTimeout()` (line 523) tests `discoveredPeripherals.isEmpty`; extend it
to `discoveredPeripherals.isEmpty && discoveredMeshtasticDevices.isEmpty` or the
retry loop will keep restarting a scan that has already found a deck.

Add:

```swift
func connectMeshtastic(to device: DiscoveredMeshtasticDevice) {
    stopScanning()
    meshtasticManager.connect(to: device.peripheral)
}
```

`disconnect()` (line 694) routes by transport; add the Meshtastic clause above
the `bleManager.disconnect()` fallthrough:

```swift
if meshtasticState == .ready || meshtasticState == .connected {
    // Meshtastic clients are expected to write ToRadio{disconnect: true} so the
    // radio stops queuing for a phone that has gone. Pass those bytes in when
    // the protocol layer can encode them; nil just drops the link.
    meshtasticManager.disconnect(farewell: MeshtasticProtocol.buildDisconnect())
    return
}
```

---

## 4. `PommeCoreViewModel` — the specific edits

File: **`ios/Shared/ViewModels/PommeCoreViewModel.swift`**

`wireConnectionCallbacks()` (line 322) gains:

```swift
connectionManager.onToRadioFrameReceived = { [weak self] data in
    self?.handleMeshtasticFrame(data)
}
```

`onDeviceReady()` (line 493) currently calls `connectionManager.refreshAllSettings()`,
which fires twelve MeshCore commands. Gate it:

```swift
private func onDeviceReady() {
    if connectionManager.activeTransport == .meshtastic {
        // A deck answers one question: ToRadio{want_config_id}. It replies with
        // my_info, metadata, one node_info per node, the channel, the LoRa
        // config, then config_complete_id echoing the nonce.
        connectionManager.sendToRadio(MeshtasticProtocol.buildWantConfig(id: UInt32.random(in: 1...UInt32.max)),
                                      label: "WANT_CONFIG")
        return
    }
    ... existing MeshCore path unchanged ...
}
```

`handleDisconnect(previousState:)` (line 346) already resets every store and is
protocol-agnostic; it needs no change.

---

## 5. What the stores need to receive

The decoded FromRadio messages have to arrive as the app's existing model types.
Nothing in the UI needs a new shape — every screen below already reads these.

### 5.1 Nodes — `ContactStore`

File: **`ios/Shared/Stores/ContactStore.swift`**, property `var contacts: [Contact]`
(line 27). `Contact` is `MeshCoreKit.Contact`; its initialiser is:

```swift
Contact(publicKey:name:type:flags:outPathLen:outPath:lastAdvert:latitude:longitude:lastmod:)
```

From `FromRadio.node_info` (deck source: `encodeApiNodeInfo` in
`src/core/meshtastic_api.cpp`, fields `num`, `user.long_name`,
`user.short_name`, `position.latitude_i/longitude_i` in 1e-7 degrees, `snr`):

| `Contact` field | From |
| --- | --- |
| `publicKey` | a synthetic 32-byte key derived from `num` — see below |
| `name` | `user.long_name` |
| `type` | `.chat` |
| `flags` | `0` |
| `outPathLen` | `-1` (a deck reports no path) |
| `lastAdvert` | `UInt32(Date().timeIntervalSince1970)` at receipt |
| `latitude` / `longitude` | `Double(latitude_i) / 1e7` |

Meshtastic identifies a node by a 32-bit `num`, MeshCore by a 32-byte public key
whose first six bytes are the routing prefix. Derive one from the other and use
the **same derivation everywhere**, or the map, the chat list and the node list
will key three different conversations off one node:

```swift
/// A Meshtastic node has a 32-bit number where a MeshCore contact has a
/// 32-byte key. The 0xMT tag keeps the derived prefix out of the space real
/// MeshCore prefixes occupy, so the two protocols can never collide in a store
/// keyed by `publicKeyPrefix`.
static func syntheticKey(forNodeNum num: UInt32) -> Data {
    var key = Data([0x4D, 0x54])                       // "MT"
    key.append(contentsOf: withUnsafeBytes(of: num.bigEndian, Array.init))
    key.append(Data(repeating: 0, count: 32 - key.count))
    return key
}
```

That makes `publicKeyPrefix` (the first six bytes) `4D 54 <num big-endian>` —
unique per node, stable across reconnects, and never a valid MeshCore prefix.

Call `contactStore.recordPosition(for: contact)` (line 498) after updating a
contact that carries coordinates: that is what fills `positionTrail(for:)`.

### 5.2 Map — no new plumbing

File: **`ios/Shared/Views/MeshMapView.swift`**. It reads
`contactStore.contacts.filter { $0.latitude != 0 || $0.longitude != 0 }` (line 473)
and `contactStore.positionTrail(for:)` (line 545). Populate `contacts` per 5.1 and
the map draws the deck's nodes with no change to the view.

Positions arrive two ways and both must land in `contacts`: inside the config
dump's `node_info`, and afterwards as `FromRadio.packet` with
`portnum == POSITION_APP` (deck source: `encodeApiPositionPacket`).

### 5.3 Chat — `MessageStoreManager`

File: **`ios/Shared/Stores/MessageStoreManager.swift`**.

- **Incoming**: build a `MeshCoreKit.Message` and call
  `handleIncomingMessage(_:) -> Message?` (line 569). It de-duplicates, persists,
  bumps the unread count and returns the message when a notification should be
  posted — mirror what `PommeCoreViewModel+ResponseHandling.swift` does with the
  MeshCore path.

  ```swift
  Message(
      senderKeyHash: syntheticKey(forNodeNum: fromNode).prefix(6),
      contactKeyHash: dest == 0xFFFF_FFFF ? Data([0])                       // broadcast
                                          : syntheticKey(forNodeNum: fromNode).prefix(6),
      text: text,
      timestamp: Date(),
      isOutgoing: false,
      status: .sent,
      snr: nil,                    // see note
      hops: nil,
      channelIndex: dest == 0xFFFF_FFFF ? 0 : nil,
      senderName: nodeLabel(for: fromNode)
  )
  ```

  `Data([0])` is the channel-0 key `sendChannelMessage` already uses (line 367),
  so broadcast traffic lands in the same thread the operator sends into.

  `Message.snr` is `Int8?` in raw MeshCore units (dB × 4). The deck sends SNR as
  a float in dB. Convert with `Int8(clamping: Int(snrDB * 4))` or leave it nil —
  do not pass dB straight through, the UI divides by 4.

- **Outgoing**: `sendTextMessage(_:to:)` (line 280) and
  `sendChannelMessage(_:channelIndex:)` (line 353) both call
  `MeshCoreProtocol.build…` and then `sendCommand?`. They need a transport branch
  that builds a Meshtastic `ToRadio{packet}` and calls `sendToRadio` instead.
  Stamp a random non-zero `packet_id` and keep it: the deck answers with
  `FromRadio{packet}` carrying a `Routing` result whose `request_id` is that id
  (`encodeApiRoutingAck`), and **that** is what moves the message from `.sending`
  to `.sent`. Without it the bubble says "Sending…" forever. Feed it through
  `handleSentResponse(expectedACK:suggestedTimeoutMs:)` (line 417) or
  `handleSendConfirmed(ackCode:roundTripMs:)` (line 455).

- **Per-radio isolation**: `activateForRadio(_ prefix: String)` (line 120) keys
  the encrypted message store. Call it — and `channelStore.activateForRadio` —
  with `String(format: "%08x", myNodeNum)` from `FromRadio.my_info`, exactly
  where the MeshCore path calls it on `.selfInfo`
  (`PommeCoreViewModel+ResponseHandling.swift` line 70). Skip this and a deck's
  messages get written into the last MeshCore radio's store.

### 5.4 Device panel — `DeviceConfig`

`FromRadio.metadata.firmware_version` (the deck reports
`"2.6.0-lilyshark.N"`) belongs in `deviceConfig.semanticVersion`, and
`my_info.my_node_num` in `deviceConfig.publicKeyHex` as
`String(format: "%08x", num)`. Everything else on the Settings screen —
frequency, bandwidth, SF, CR, TX power, battery — has no source in the deck's
config dump. See **Not wired yet #5**.

---

## 6. Scanner UI

File: **`ios/Shared/Views/DeviceScannerView.swift`**. Line 83 iterates
`connectionManager.discoveredPeripherals` and line 85 calls
`connectionManager.connect(to:)`. Add a second `ForEach` over
`connectionManager.discoveredMeshtasticDevices` calling `connectMeshtastic(to:)`.

Do **not** merge the two lists. They hold `CBPeripheral`s owned by different
centrals, and connecting through the wrong manager fails in a way that looks like
a flaky radio.

---

## 7. Not wired yet

Stated plainly, because each of these will otherwise be discovered as a bug.

1. **No protobuf codec here.** `fromRadioSubject` emits bytes. Every
   `MeshtasticProtocol.build…` / decode call in this document is a symbol the
   protocol-layer agent owns and which may not exist yet.
2. **`ConnectionManager` and `PommeCoreViewModel` are untouched.** Sections 3 and
   4 are instructions, not applied diffs — those files belong to another agent.
3. **`project.yml` is untouched.** The package is not in the Xcode project, so
   nothing in the app can import it yet.
4. **The deck acts on three ToRadio messages only.** `parseApiToRadio`
   (`src/core/meshtastic_api.cpp`) handles `want_config_id`, `disconnect`, and a
   `packet` carrying a text. Everything else — position from the phone, channel
   edits, config writes, admin messages, traceroute, telemetry — parses to
   `Kind::None` and is discarded **silently**. The app must not offer UI for them
   on a Meshtastic link.
5. **The config dump is deliberately thin.** `encodeApiConfigMessage` sends
   `my_info`, `metadata`, node list, one primary channel with the default PSK,
   and a LoRa config hardcoded to preset LONG_FAST / region US / hop limit 3.
   Region and preset shown in the app are constants, not the deck's real radio
   settings; treat them as placeholders, not as something to write back.
6. **The node list is capped at nine.** `service_ble_api()` collects at most
   eight heard nodes plus self, and skips anything not heard on the Meshtastic
   protocol. The app's node list is a window, not the deck's full picture.
7. **The deck queue is eight deep, 512 bytes per message, and drops on full.**
   `queueBleFromRadio` returns false and live node/text/position frames are
   discarded when the phone is slow to read. This is why the manager drains
   eagerly rather than on a timer.
8. **Long FromRadio payloads are corrupted by design of the pair.** The firmware
   pops a new protobuf on *every* read callback instead of serving offsets into
   the one already handed out. iOS negotiates ATT_MTU 185 by default, so anything
   over ~184 bytes makes CoreBluetooth issue a blob read and the continuation
   carries the *next* message's bytes: one packet arrives spliced, another
   disappears. Config-dump frames are all comfortably under this; a text near the
   237-byte Meshtastic limit is not. The manager logs an error when it sees a
   payload that cannot have fitted one read response — grep the log for
   "exceeds the". **The fix is firmware-side**: `FromRadioEvents::onRead` must
   use the `esp_ble_gatts_cb_param_t` overload and only pop when
   `param->read.offset == 0`, caching the message for the continuation reads.
9. **No pairing/bonding on a deck.** `tdeck_ble.cpp` sets no security, so a deck
   connects with no PIN. Stock Meshtastic firmware *does* bond; pointing this
   manager at one surfaces a system pairing prompt, and a cancelled pairing
   arrives as an "Encryption is insufficient" error on the FromNum subscription.
   The manager stops auto-reconnecting on that error and clears the saved
   peripheral, so the prompt is not replayed — but there is no UI yet for
   entering a PIN, so a bonded radio is out of reach.
10. **No tests.** CoreBluetooth has no headless simulator: a `CBCentralManager`
    on a build machine reports `.unsupported` and never scans. The manager
    compiles and the drain/write state machine is straightforward to read, but
    none of it has been exercised against a radio. First real check is a deck on
    a bench, watching for "Subscribed to FromNum" then a burst of
    `fromRadioSubject` events ending in `config_complete_id`.
11. **watchOS.** The package declares watchOS 11 to match MeshCoreKit and the
    manager avoids UIKit, but no watch screen reaches a deck.
