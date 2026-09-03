# PommeCore Localization Guide

## Source Language
English (`en`) — all string keys use the English text as the key.

## Supported Languages
| Code | Language | Status |
|------|----------|--------|
| `en` | English  | Source |
| `de` | German   | In progress |
| `pl` | Polish   | Planned |
| `fr` | French   | Planned |
| `ja` | Japanese | Planned |
| `cs` | Czech    | Planned |

## Adding a New Language

1. In Xcode: **Project Settings → Info → Localizations → +** → select language
2. Open `Shared/Localizable.xcstrings`
3. Build once — Xcode extracts any new source strings automatically
4. In the catalog, switch to the new language column and fill in translations
5. Run the app with **Edit Scheme → Run → Options → App Language** set to the new language
6. Walk every screen; fix layout issues (see Layout Fixes section below)

## Testing with Pseudolanguages

In Xcode Edit Scheme → Run → Options → App Language:

- **Double-Length Pseudolanguage** — doubles every string length, catches truncation
- **Accented Pseudolanguage** — adds accents to reveal missing localizable strings
- **Right-to-Left Pseudolanguage** — mirrors layout (not required; no RTL languages planned)

Run Double-Length before shipping any new language to catch layout regressions early.

## Strings Intentionally NOT Localized

### Technical Units and Protocol Terms
These appear verbatim in all languages — translators must leave them unchanged:

- RF measurements: `dBm`, `RSSI`, `SNR`, `MHz`, `kHz`, `dBi`
- LoRa parameters: `SF7`–`SF12`, `CR 4/5`, `CR 4/6`, `CR 4/7`, `CR 4/8`, `BW`
- Protocol names: `LoRa`, `BLE`, `WiFi`, `TCP`, `UDP`, `MQTT`
- Regulatory identifiers: `FCC`, `EU-868`, `US-915`, `AU-915`, `JP-920`, `IN-865`

### Brand and Product Names
- `MeshCore` (network/protocol name)
- `PommeCore` (app name)
- Hardware brands: `Heltec`, `RAK`, `LilyGo`, `T-Beam`, `WisMesh`, `nRF`, `Nordic`

### User-Generated Content
- Contact names, device names, node names (reported by hardware or set by the user)
- Channel names (network-defined)
- Message content
- Nicknames, notes, group names

### Data Representations
- Hex strings, public key prefixes, MAC addresses
- Firmware version strings (e.g., `companion-v1.15.0`)
- File extensions: `.bin`, `.zip`, `.json`
- Default passwords (`password`, `hello`) — these are firmware-defined literals

### Debug and Log Strings
All `DebugLogger.shared.log(...)` and `Self.logger.info(...)` calls stay in English
for debugging clarity. These are never user-facing.

### Error Details from BLE / Firmware
Raw CBError/GATT codes stay in English. Friendly wrapper messages
("Could not connect", "Scanning for radios") are localized.

## Plural Handling

All count-bearing strings use Swift's `^[count word](inflect: true)` syntax:

```swift
// Correct — works for all languages via xcstrings plural rules
Text("^[\(count) hop](inflect: true)")
Text("^[\(count) contact](inflect: true) can request your telemetry data.")

// For non-Text contexts (ViewModels, Stores)
String(localized: "^[\(hops) hop](inflect: true)")
```

The xcstrings catalog contains `one` / `other` slots for Germanic languages and
`one` / `few` / `many` / `other` for Polish. Fill all slots when adding Polish (pl).

Do NOT use manual ternaries like `count == 1 ? "" : "s"` — they break for every
non-English language.

## Non-View String Wrapping

For strings in ViewModels and Stores (non-SwiftUI contexts), use:

```swift
// Status and error messages
String(localized: "Connected to device")
String(localized: "Scanning for radios...")

// With interpolation
String(localized: "Connected to \(deviceName)")
```

SwiftUI `Text("...")`, `Button("...")`, `Label("...")` literals are extracted
automatically at build time — no wrapper needed for those.

## Date and Time Formatting

Use `.formatted()` throughout — never `DateFormatter` with hardcoded styles:

```swift
// Correct — respects locale
date.formatted(date: .abbreviated, time: .shortened)
date.formatted(date: .abbreviated, time: .omitted)

// Section headers ("Today" / "Yesterday")
String(localized: "Today")
String(localized: "Yesterday")
```

## Distance and Measurement

Distances shown in LoS analysis views use hardcoded metric strings (e.g., `±100m (~1 block)`).
These are provided as informational context labels — they use approximate imperial equivalents
for reference. When adding non-metric locales, consider replacing the parenthetical
with a `Measurement<UnitLength>.formatted()` call instead.

## Layout Fixes Applied

German strings run approximately 20–30% longer than English. The following fixes
were applied during initial German testing:

*(Fill in after layout stress-test pass with German locale)*

- Add `.minimumScaleFactor(0.8)` to tight single-line labels as needed
- Use `.fixedSize(horizontal: false, vertical: true)` where wrapping is acceptable
- Tab bar labels: keep translations short (≤10 chars for German)

## Translator Notes

- Use formal **Sie** (not du) in German — this is a technical app used by radio operators
- Do not translate technical terms listed above
- Keep button labels concise — German tabs and toolbar buttons have limited width
- "Hop" in networking context = Zwischenknoten (or just "Hop" — acceptable loanword in German radio community)
- "Flood" in networking context = Rundsenden or Übertragung — not the English word "flood"
- "Channel" (radio channel) = Kanal
- "Path" (routing path) = Pfad or Route (not "Weg")
- "Signal" (RF signal) = Signal (same)
- "Mesh" = Mesh or Maschennetz (Mesh is widely accepted)
