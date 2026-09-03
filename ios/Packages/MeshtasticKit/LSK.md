# The LSK analyzer link

The wire protocol a Lilyshark T-Deck speaks over USB CDC, as implemented by
`Sources/MeshtasticKit/Analyzer/` and as cross-checked against the firmware in
`src/sim_main.cpp` at the line numbers named below.

Plain newline-delimited text at 115200 baud. Every streamed line is

```
LSK <kind> <one JSON object>\n
```

and every command is a bare line the firmware compares with `strcmp` or
`strncmp`. Because it is text, a serial monitor shows a human exactly what the
app sees — which is why the link is text in the first place.

---

## 1. Who is authoritative for what

Nothing in this package is a second source of truth. Each line kind has exactly
one printer in the firmware, and one reader here.

| Line | Firmware printer | File | Read by |
|---|---|---|---|
| `LSK ID` | `handle_analyzer_link_command` | `src/sim_main.cpp:16150–16156` | `LSKDecoder.decodeIdentity` |
| `LSK T` | `loop()`, the 2000 ms telemetry block | `src/sim_main.cpp:16399–16445` | `LSKDecoder.decodeTelemetry` |
| `LSK F` | `emit_analyzer_heard_frame` | `src/sim_main.cpp:9806–9899` (the print at `:9845`) | `LSKDecoder.decodeFrame` |
| `LSK S` | `emit_analyzer_sweep_result` | `src/sim_main.cpp:16116–16145` | `LSKDecoder.decodeSweep` |
| `LSK P` | the frame-ingest path, on `decode_frame_shelby_pointer` | `src/sim_main.cpp:10198–10224` (the print at `:10220`) | `LSKDecoder.decodePointer` |
| `LSK OK` / `LSK ERR` | `handle_mesh_tx_command`, `handle_mesh_inject_command`, `handle_sweep_link_command` | `src/sim_main.cpp:15878–16109` | `LSKDecoder.decode`, `OK`/`ERR` branches |

| Command | Firmware branch | File |
|---|---|---|
| `LSK HELLO` | `strcmp`, `handle_analyzer_link_command` | `src/sim_main.cpp:16150` |
| `LSK BYE` | `strcmp`, same | `src/sim_main.cpp:16167` |
| `LSK TX …` | `strncmp` 7, → `handle_mesh_tx_command` | `src/sim_main.cpp:16174` |
| `LSK INJ …` | `strncmp` 8, → `handle_mesh_inject_command` | `src/sim_main.cpp:16176` |
| `LSK SWEEP …` | `strncmp` 10, → `handle_sweep_link_command` | `src/sim_main.cpp:16178` |
| `LSK NODE …` | **never dispatched** — see §6 | `src/sim_main.cpp:15880` |

The command dispatcher's `TX` / `INJ` / `SWEEP` branches are inside
`#if defined(LILYSHARK_DEVICE)` (`src/sim_main.cpp:16173–16180`), so a simulator
build answers `LSK HELLO` and `LSK BYE` and silently ignores the rest.

The browser client this package mirrors is `webapp/src/lib/deviceLink.ts`
(parsing) and `webapp/src/lib/spectrum.ts` (`parseSpectrumBody`). Where the two
readers differ, §7 says so and why.

---

## 2. Opening and closing

```
host → LSK HELLO
deck → LSK ID {"app":"lilyshark","fw":"<version>","board":"t-deck","node":"!a1b2c3d4"}
```

`node` is `%08lx` of `localMeshtasticNodeNum()`, always eight lowercase hex
digits behind a `!`.

The deck answers **every** `LSK HELLO`, not only the first, so a host may re-ask
at any time. Only the first one also logs "Web analyzer linked over USB" and, on
a device build, transmits a NodeInfo and (with a fix) a Position.

`LSK BYE` clears `analyzer_link_active`, and the deck stops streaming. It is not
optional housekeeping: without it the deck keeps printing to a port nobody
reads.

`LSKSerialLink` sends HELLO 800 ms after opening and repeats every 1.2 s for up
to 20 s, up to three opens with a 4 s gap. Those numbers are
`webapp/src/lib/deviceLink.ts`'s, and they exist because opening an ESP32-S3's
native USB resets the board: the first attempt on a cold cable normally ends
with the stream dropping, which is the board re-enumerating rather than a
failure. `LSKHandshakePolicy` is that rule, and it mirrors `nextSerialAction`.

---

## 3. The stream

### `LSK T` — telemetry, every 2000 ms

```json
{"bat":"BAT 84%","gps":"GPS 9","profile":"US 915 LONGFAST","frames":41,
 "rssi_x10":-912,"snr_x10":63,"sim":false,
 "lat":37.911000,"lon":-122.018000,
 "mv":3985,"pct":84,"sat":9,"freq_hz":906875000,"sf":11,"bw_hz":250000,
 "rx":128,"crc":3}
```

`lat` and `lon` appear only with a GPS fix — the firmware has two printf calls
and picks between them (`src/sim_main.cpp:16406` and `:16426`). Everything from
`mv` onward is optional in the codec, because it arrived later than the link
itself.

Two names mislead and are worth stating plainly:

- **`frames` is not a count.** It is `newest->sequence`, the sequence number of
  the newest frame in the deck's capture ring, and `0` when the deck has heard
  nothing. `LSKTelemetry` calls it `newestFrameSequence`.
- **`rx` is the count**, `radio_service.status().received_frames`, with `crc`
  the CRC failures beside it.

`rssi_x10` / `snr_x10` are of that newest frame, and are `0` when there is none.

### `LSK F` — one heard frame

The decoded half, then the whole `.lscap` record, then the payload:

```json
{"src":2882400001,"dst":4294967295,"proto":"Meshtastic","port":1,"hops":2,
 "rssi_x10":-912,"snr_x10":63,"kind":"TEXT","sim":false,
 "lat":…,"lon":…,"name":"…","short":"…","text":"…",
 "seq":41,"ts":…,"pf":…,"freq":…,"bw":…,"br":…,"fdev":…,"air":…,"ferr":…,
 "pre":…,"sync":…,"prof":…,"rstat":…,"txp":…,"sf":…,"cr":…,"ch":…,"ridx":…,
 "mod":…,"dir":…,"crc":…,"mflags":…,"olen":…,"hex":"0a0b…"}
```

- `proto` is `protocolName()` from `include/lilyshark/core/protocol.h`:
  `Meshtastic`, `MeshCore`, `Reticulum`, `Custom`, `Unknown`.
- `kind` is `packetKindLabel()` from `src/ui/packet_presentation.cpp` — the
  deck's own one-word label (`TEXT`, `BAD`, `UNSUP`, `RSVD`, …).
- `hops` is `hop_start - hop_limit`, and **`-1` is a sentinel** meaning the frame
  carried no `hop_start`. The codec turns that into `nil`, never into a hop
  count of minus one.
- `lat` / `lon` / `name` / `short` / `text` appear only when the payload decoded.
- `olen` is the length on the air; `hex` is what the capture buffer held. When
  `olen` is larger, the frame was clipped — `LSKRawFrame.isTruncated`.
- `mflags` is a bit set: `1` implicit header, `2` inverted IQ, `4` synthetic,
  `8` net-relayed (`src/sim_main.cpp:9888–9891`).

Strings are put through `json_copy_ascii` (`src/sim_main.cpp:9794`), which drops
`"`, `\` and every byte under 0x20 — so the body cannot be broken by a node
name, but a **multi-byte name truncated at the deck's fixed field width can
arrive as invalid UTF-8**. `LSKLineAssembler` decodes with replacement rather
than failing, so that costs one character in one field and not the line.

#### Provenance

This is a safety property, not a nicety. `LSKHeardFrame.origin` reports:

| | Meaning |
|---|---|
| `.air` | `mflags` says neither synthetic nor net: heard by this deck's SX1262. |
| `.synthetic` | `mflags & 4`, or `sim` on a line with no record. Never on any air. |
| `.net` | `mflags & 8`. Heard by some **other** radio and injected with `LSK INJ`. |
| `.unstated` | The line carried no `.lscap` record, so the deck did not say. |

Two rules the codec keeps, and any UI on top of it must keep:

1. **`.net` beats `.synthetic`** when both bits are set, so no future flag
   combination can downgrade a net-relayed frame into something that looks
   locally heard.
2. **`.unstated` is not `.air`.** Firmware older than the capture link sends
   only `sim`, which distinguishes synthetic from everything else and leaves
   net-relayed and over-the-air indistinguishable. Presenting one of those as
   locally received would be a claim the deck never made.

Separately, the firmware refuses to put an operator-key decode on this link at
all: `emit_analyzer_heard_frame` reads a payload only when the frame has
`AttributeDefaultKeyReadable` (`src/sim_main.cpp:9824`), because the line has no
field naming which key opened it and a borrowed key's plaintext would arrive
looking exactly like traffic anybody within earshot could read. The raw bytes
still travel in `hex`, so nothing is hidden — it simply does not get a decode it
cannot label. **This codec adds no decoding of its own**, so that property
survives unchanged.

### `LSK S` — one sweep pass

```json
{"f0":902000000,"f1":906000000,"bins":64,"db":[-128,-121,…]}
```

`f0` and `f1` are the **outer edges** of the reported bins, not bin centres:
`emit_analyzer_sweep_result` pushes each end half a step outward precisely so a
reader placing bin *i* at `f0 + (i + 0.5) * (f1 - f0) / bins` lands back on the
frequencies the SX1262 was tuned to (`src/sim_main.cpp:16128–16134`).
`LSKSweep.binCenterHz(_:)` is that arithmetic.

Each value is the strongest occupied power bin at that point, in whole dBm; a
point the scanner never filled reports the catch-all floor bin rather than
inventing a reading.

`bins` must equal `db.count` or the line is refused. A line clipped mid-array
parses as JSON often enough, and plotting the surviving half stretched across
the whole band would look like a real measurement of a band nothing measured.

### `LSK P` — a Shelby pointer

```json
{"size":4096,"expires":1780000000,"owner":"0x<64 hex>","commit":"0x<64 hex>"}
```

Owner and commitment are 32 bytes each
(`include/lilyshark/shelby/shelby_pointer.h:45–46`), printed `0x` then 64
lowercase hex digits, and kept as printed.

### `LSK OK` / `LSK ERR`

| Command | On success | On refusal |
|---|---|---|
| `LSK SWEEP start` | `{"kind":"sweep","state":"started"}` | `{"reason":"simulate-mode"}`, `"survey-running"`, `"sweep-already-running"`, `"bad-sweep"`, or the scanner's own failure string |
| `LSK SWEEP stop` | `{"kind":"sweep","state":"stopped"}` | `{"reason":"bad-sweep"}` |
| `LSK INJ <hex>` | `{"kind":"inj"}` | `{"reason":"bad-inj"}` |
| `LSK TX meshcore advert[ flood]` | `{"proto":"meshcore","kind":"advert","reach":"zero-hop"\|"flood"}` | `{"proto":"meshcore","reason":"…"}` |
| `LSK TX meshtastic text\|dm\|position\|nodeinfo` | `{"proto":"meshtastic","kind":"text"\|"dm"\|"position"\|"nodeinfo"}` | **the same body**, with `ERR` instead of `OK` |
| anything else after `LSK TX ` | — | `{"reason":"bad-tx"}` |

That last row is the trap: `handle_mesh_tx_command` prints
`"LSK %s {\"proto\":…,\"kind\":…}"` and only swaps `OK` for `ERR`
(`src/sim_main.cpp:15942`, `:15980`, `:15990`, `:15996`). **A failed transmit
carries no `reason` at all**, which is why `LSKFault.reason` is optional and a
missing one is not a parse failure.

---

## 4. Commands

| Case | Line |
|---|---|
| `.hello` | `LSK HELLO` |
| `.goodbye` | `LSK BYE` |
| `.sweepStart` / `.sweepStop` | `LSK SWEEP start` / `LSK SWEEP stop` |
| `.broadcastText(t)` | `LSK TX meshtastic text <t>` |
| `.directMessage(node:text:)` | `LSK TX meshtastic dm <8 hex> <text>` |
| `.sendPosition` | `LSK TX meshtastic position` |
| `.sendNodeInfo` | `LSK TX meshtastic nodeinfo` |
| `.meshcoreAdvert(flood:)` | `LSK TX meshcore advert` / `… advert flood` |
| `.injectFrame(bytes)` | `LSK INJ <lowercase hex>` |
| `.rumourNode(…)` | `LSK NODE <8 hex> <lat×1e7> <lon×1e7> <label>` — see §6 |

`LSKCommand.encoded()` refuses, with a reason, everything the deck refuses, plus
the one thing the deck does not report:

- empty text, and any control character in text — a newline would end the
  command early and turn its tail into a second, garbage command;
- an empty frame, or one past `kMaxFrameBytes` = 255
  (`include/lilyshark/core/raw_frame.h:9`);
- node id `0` or `0xffffffff`, and a label that is empty, over eight bytes, or
  contains a space — `sscanf(line + 9, "%8lx %ld %ld %8s")` into `char[9]`;
- **any line past 239 bytes.**

That last limit is the silent one. The deck reads into
`char analyzer_link_line[240]` (`src/sim_main.cpp:397`) and stores a byte only
while `length + 1 < 240` (`src/sim_main.cpp:16311`), so 239 bytes is the longest
line it can hold. A longer one resets the buffer mid-line: the command is lost
**with no reply**, and its tail is then parsed as a command of its own. In
practice:

- the longest injectable frame is **115 bytes** (`LSK INJ ` is 8 characters, so
  `8 + 2×115 = 238`) — a full 255-byte frame cannot be injected at all;
- the longest broadcast text is **216 bytes** (`LSK TX meshtastic text ` is 23).

---

## 5. Framing on the host side

`LSKLineAssembler` turns read chunks into lines. It exists because a USB CDC
`read()` hands back whatever was in the buffer — a line and a half, six bytes,
the tail of a line printed before the host opened the port — and none of those
boundaries mean anything.

- Terminates on `\n` **and** `\r`, because `Serial.printf` writes `\n` and
  `Serial.println` writes `\r\n`; empty lines are dropped so `\r\n` does not
  yield a blank second line.
- Decodes with U+FFFD replacement, never failing (see §3, truncated names).
- Discards an unterminated line past `lineLimit` (8192 by default, against a
  worst case around 800 characters) and counts it in `oversizeLinesDropped`.
  Unlike the firmware, which resets its buffer and lets the tail become a bogus
  line, the assembler skips to the next terminator: a tail that decodes as
  nothing is better than a spliced line that decodes as something.
- `reset()` on connect and disconnect, so the tail of a line from before a
  reconnect cannot be glued to the head of one after.

`LSKDecoder.decode` returns one of three things, and the middle one matters:

- `.notAnalyzerTraffic` — boot banners (`Lilyshark starting`), framing noise, and
  our own commands echoed back by a port with echo left on;
- `.malformed(kind:)` — `LSK <known kind> …` whose body is not a usable JSON
  object. A reset mid-print produces exactly this, so it is routine and not a
  reason to drop the link — but it is reported, not swallowed, so that a stream
  which is mostly rubbish cannot look like a healthy quiet one;
- `.line(…)` — including `.unknown(kind:body:)` for a kind this build has never
  heard of. Firmware ships ahead of apps, and an unknown kind is handed back
  verbatim rather than judged against a grammar we do not have.

---

## 6. `LSK NODE` does not work, and here is the proof

`handle_mesh_tx_command` opens with a `"LSK NODE "` branch
(`src/sim_main.cpp:15880`) that fills `net_rumour_nodes` and answers
`LSK OK {"kind":"node"}`. It is unreachable.
`handle_analyzer_link_command` calls that function on one condition only:

```c
} else if(std::strncmp(line, "LSK TX ", 7) == 0) {   // src/sim_main.cpp:16174
    handle_mesh_tx_command(line);
```

and it is the only call site (`grep -n handle_mesh_tx_command src/sim_main.cpp`
gives the definition at 15878 and that one call at 16175). A line beginning
`LSK NODE ` matches no branch of the dispatcher, so it falls off the end of the
`if`/`else` chain: no effect, and no reply.

`webapp/src/mesh/netNodes.ts:93` sends this line to a linked deck for the
sixteen nearest internet-known nodes. Those lines are being dropped today.

`LSKCommand.rumourNode` is included so this package already speaks the grammar
the firmware means to accept, and its `expectedReply` is `.none` so no caller
blocks on an answer that is not coming. **Do not present it in the UI as a
working feature until the dispatcher gains a `"LSK NODE "` branch.** The fix is
firmware-side and one `else if`.

---

## 7. Where this reader differs from the browser's

Deliberate, and each for a reason:

1. **Odd-length or non-hex `hex` drops the whole raw record.**
   `parseRawFrameFields` in `deviceLink.ts` slices an odd digit off and keeps
   going. A clipped hex string still parses as JSON when the clip lands past the
   closing quote, and padding it produces a `.lscap` record that looks complete
   and is not. The decoded frame still lists either way.
2. **A sweep whose `f0` is 0 is accepted.** `parseSpectrumBody` requires
   `f0 > 0`. The firmware genuinely clamps to 0 when the first point is below
   half a step (`src/sim_main.cpp:16132–16133`), which cannot happen on a LoRa band
   but is what the emitter says.
3. **`LSK ID` with a missing field is malformed, not an empty string.** The
   browser takes `String(body.fw ?? '')`. Accepting a blank version would let a
   half-printed line link.
4. **Half a fix is no fix.** A `lat` without a `lon` yields neither, on both
   `LSK T` and `LSK F`. A latitude alone on a map is a pin in the Gulf of
   Guinea.
5. **An unknown kind is returned rather than dropped.** `parseLskLine` returns
   `undefined`.

One thing is duplicated on purpose: `LSKSerialPort.bridgeVendorIDs` is a second
copy of `KNOWN_USB_VENDORS` in `deviceLink.ts`, because a TypeScript constant
cannot be imported into Swift. It is a discovery heuristic and not a protocol
table — being wrong costs a port that has to be picked by hand, never a misread
frame. If the two disagree, `deviceLink.ts` is the one with a browser's port
picker behind it.

---

## 8. Platforms

**macOS: works.** `LSKSerialLink` is compiled under `#if os(macOS)`. It finds
ports with IOKit (`kIOSerialBSDServiceValue`, filtered to `/dev/cu.*`, ranked
Espressif `0x303A` first), opens with POSIX `open`/`termios` in raw mode at
115200 with `VMIN 0` / `VTIME 2`, and clears DTR and RTS with `TIOCMBIC` so the
board does not land in the bootloader.

**iOS and iPadOS: not possible.** Not "hard", not "needs an entitlement" —
there is no API. Checked against the iOS 26.5 SDK in Xcode 26.6:

1. **IOKit's serial family is macOS-only.**

   ```
   $ xcrun --sdk iphoneos swiftc -target arm64-apple-ios18.0 -typecheck probe.swift
   probe.swift:1:8: error: no such module 'IOKit'
   1 | import IOKit
   ```

   `IOKit.framework` does ship in the iOS SDK, but as a header set with no
   Swift module and no serial headers at all —
   `iPhoneOS26.5.sdk/System/Library/Frameworks/IOKit.framework/Headers` holds
   `IOKitLib.h`, `IOTypes.h`, `IOReturn.h` and the like; there is no
   `IOKit/serial`, no `kIOSerialBSDServiceValue`. There is also no `/dev/cu.*`
   to open with `termios` even if there were.

2. **ExternalAccessory needs an MFi accessory, and a T-Deck is not one.**
   `EASession` can only be opened as
   `initWithAccessory:forProtocol:`
   (`ExternalAccessory.framework/Headers/EASession.h:24`), and the protocol
   string has to come from the accessory's own `protocolStrings`
   (`EAAccessory.h:43`), which an accessory advertises through the MFi iAP
   handshake. An ESP32-S3 presenting bare USB CDC never becomes an
   `EAAccessory` at all, and Apple does not certify one.

3. **AccessorySetupKit is Bluetooth and Wi-Fi only.** Every match on
   `ASDiscoveryDescriptor` is a `bluetooth*` property, an SSID, or a Wi-Fi Aware
   service role. There is no USB descriptor.

4. **iOS 26's AccessoryTransportExtension has no USB transport.** From
   `AccessoryTransportExtension.framework/Modules/AccessoryTransportExtension.swiftmodule/arm64e-apple-ios.swiftinterface`:

   ```swift
   public enum AccessoryTransport : Swift.Sendable {
     case bluetooth
     case internet
     case localNetwork
   }
   ```

5. **DriverKit does not close the gap for this app.** `USBSerialDriverKit` and
   `SerialDriverKit` exist, but only in the DriverKit SDK, whose deployment
   target is DriverKit's own — a driver extension shipped inside a **Mac** app.
   There is no `driverkit` entitlement or platform in the iPhoneOS SDK here.

So `LSKUSBAvailability.current` is `.unavailable(…)` on iOS with a sentence an
operator can act on, and the app should say that rather than offer a button that
quietly does nothing. Bluetooth still carries chat on iOS: that is
`MeshtasticBLEManager` and `MeshtasticProto`, and it is unaffected by any of
this.

**watchOS: no USB port, no serial API.** `LSKUSBAvailability.current` says so.
The codec itself compiles and runs everywhere — it is pure Foundation.

---

## 9. What has and has not been exercised

**Verified** (`swift test`: 90 tests in the package, 0 failures; 69 of them
under `--filter LSK` — 38 codec, 15 command, 7 policy, 9 against a pty):

- The codec against lines built field-for-field from the firmware's own printf
  format strings, including malformed bodies, truncated JSON, unknown kinds,
  invalid UTF-8, and every provenance combination.
- The line assembler against split reads, byte-at-a-time delivery, `\r\n`,
  several lines in one read, and an unterminated flood.
- The commands against the exact literals the firmware's `strcmp`/`strncmp`
  branches compare, and every refusal.
- **The transport end to end against a pseudo-terminal** (`FakeDeck` in
  `LSKSerialLinkTests.swift`): real `open`, real `termios`, the real read loop
  and the real handshake, with the test writing the firmware's lines back. It
  covers coming up, a stream split across writes, the goodbye on disconnect, a
  board that answers as something else, a port that never answers, and a port
  that is not there.

**Not verified: no T-Deck has been on the other end of this.** A pty is not a
board. Three things a pty cannot reproduce, in the order they will bite:

1. The ESP32-S3 CDC reset on open, and the re-enumeration that follows. The
   retry ladder is modelled on `deviceLink.ts`, which has run against hardware,
   but this Swift implementation of it has not.
2. Bridge chips. `cfsetspeed` at 115200 matters for a CP210x or CH340 and is a
   no-op for native USB; only the native path is anything like tested.
3. Whether `/dev/cu.*` filtering plus the vendor ranking actually puts a real
   deck first on a Mac with a phone, a headset and a debug console attached.

The first real check is a deck on a bench: `LSKSerialLink.scanPorts()`, then
`connect(to:)`, then watch for `.linked` and a `LSK T` inside two seconds.
