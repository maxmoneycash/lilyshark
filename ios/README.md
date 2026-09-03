# PommeCore

Native SwiftUI companion app for [MeshCore](https://meshcore.co.uk) LoRa mesh radio devices. Runs on iPhone, iPad, Mac, and Apple Watch. Communicates over Bluetooth LE, WiFi, or USB serial using the MeshCore Companion Radio Protocol.

---

## Platforms

| Platform | Minimum Version |
|----------|----------------|
| iOS | 18.0 |
| macOS | 15.0 (Sequoia) — Apple Silicon and Intel |
| watchOS | 11.0 |

## Hardware Required

A MeshCore-compatible LoRa radio running Companion firmware is required. Tested with Heltec Mesh Pocket running MeshCore Companion firmware v1.15.0.

---

## Features

### Messaging
- Direct messages with real-time delivery tracking (Sending → Sent → Delivered with round-trip time)
- Channel (group) messages broadcast to everyone on the mesh
- Undelivered messages retry automatically, then flood the mesh
- Reactions and quoted replies, interoperable with MeshCore One
- Message drafts, unread badges, per-contact mute and block

### Contacts & Channels
- Auto-sync from radio on connect, incremental updates
- Favourites, nicknames, notes, and contact groups
- Per-group and per-channel notification mode and sound
- Export and import contacts via QR code or `meshcore://` URLs
- iCloud sync for nicknames, notes, groups, and settings

### Mesh Map
- Interactive map showing all contacts with GPS
- Position history trails (50 points per contact)
- Link quality overlay — SNR-coded lines to contacts in range
- Tap any pin to open that contact's chat

### Radio Settings & Tools
- Configure frequency, spreading factor, bandwidth, coding rate, and TX power
- Radio Stats — live core, radio, and packet statistics
- RF Monitor with Packet Log — per-packet SNR and RSSI history
- Line of Sight analysis with multi-hop repeater support and Fresnel zones
- Radio Calculator, Airtime Calculator, and Frequency Scanner
- Allowed frequency ranges shown per connected device
- Community preset library with location-based suggestions

### Backup & Updates
- Export radio configuration as a `.meshprofile` file
- Firmware update checker — alerts when a new release is available
- Over-the-air ESP32 firmware updates via WiFi

### Remote Management
- Administer repeaters and room servers over the mesh
- Change names, frequencies, routing scope, and advert intervals without physical access
- Full CLI terminal for advanced configuration

### Widgets & Watch
- Home screen and lock screen widgets — connection status, battery, unread count
- watchOS companion — read and reply to DMs and channel messages from your wrist

### Connectivity
- Bluetooth LE (iOS and macOS) — CoreBluetooth with background mode, state restoration, auto-reconnect
- WiFi (TCP) — direct connection to radio on local network
- USB serial (macOS) — binary companion mode and CLI mode

### Accessibility & Localisation
- VoiceOver, Dynamic Type, Differentiate Without Color Alone, Dark Mode, Voice Control
- 12 languages: English, German, French, Spanish, Italian, Dutch, Portuguese, Czech, Polish, Ukrainian, Japanese, Simplified Chinese

---

## Architecture

```
PommeCore/
├── Packages/MeshCoreKit/               # Swift Package — BLE, protocol, models
│   └── Sources/MeshCoreKit/
│       ├── BLE/                        # BLEManager, background mode, state restoration
│       ├── Protocol/                   # Frame parser, command builders, command/response codes
│       ├── Models/                     # Contact, Message, Channel, DeviceConfig, MessageStore
│       └── USB/                        # USBSerialManager (macOS only)
├── Shared/
│   ├── App/                            # Entry point, Theme, formatting helpers
│   ├── Stores/                         # @MainActor @Observable stores:
│   │   ├── ContactStore                #   contacts, nicknames, notes, groups, Spotlight
│   │   ├── ChannelStore                #   channels, sync, notification modes
│   │   ├── MessageStoreManager         #   messages, ACKs, drafts, unread, notifications
│   │   ├── ConnectionManager           #   BLE/WiFi/USB transport, protocol commands
│   │   ├── RemoteSessionManager        #   remote CLI sessions, network tools
│   │   ├── RFMonitorStore              #   telemetry history, RF samples
│   │   ├── LineOfSightStore            #   LoS analysis state
│   │   ├── SyncedSettings              #   iCloud KVS settings sync
│   │   └── TelemetryCloudSync          #   CloudKit telemetry history
│   ├── Services/                       # ElevationService, FirmwareUpdateChecker, LinkPreviewService
│   ├── ViewModels/                     # PommeCoreViewModel — store wiring and frame dispatch
│   └── Views/                          # All SwiftUI views
├── iOS/                                # iOS target, widgets, app intents
├── macOS/                              # macOS target resources
└── watchOS/                            # watchOS target and views
```

### Store Architecture

Six `@MainActor @Observable` stores injected via SwiftUI `.environment()`. Views read state directly from stores — there are no forwarding properties on the view model. `PommeCoreViewModel` is a thin coordinator that wires cross-store dependencies via closures and dispatches incoming protocol frames.

---

## Building

1. Open `PommeCore.xcodeproj` in Xcode 16+
2. Select the desired scheme: `PommeCore (iOS)`, `PommeCore (macOS)`, or `PommeCore Watch`
3. Build and run on device or simulator

Compile-check (zero warnings required):
```bash
./scripts/test_build.sh
```

Tests:
```bash
xcodebuild test -scheme MeshCoreKit -destination 'platform=iOS Simulator,name=iPhone 16'
```

---

## Protocol

Implements the MeshCore Companion Radio Protocol over BLE (Nordic UART Service), WiFi TCP, and USB serial.

- **BLE Service UUID:** `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- **RX Characteristic (app→radio):** `6E400002` (write)
- **TX Characteristic (radio→app):** `6E400003` (notify)
- **Frame format:** binary, little-endian, with command codes, response codes, and push notification codes (0x80–0x8F range)

See `docs/PROTOCOL.md` for the full protocol reference.

---

## Privacy

No account required. No servers. No data collection. All communication is peer-to-peer over LoRa radio. iCloud sync uses your private iCloud account.

---

## License

Copyright 2026 Michael P. Bedworth

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the full text and [NOTICE](NOTICE) for attribution requirements.
