# LSK over BLE — the GATT contract the firmware must implement

**Status: browser side written and tested, firmware side does not exist.**

Lilyshark's analyzer link (LSK) is plain, newline-delimited text between
lilyshark.com and a T-Deck running Lilyshark firmware. Today it runs over
USB CDC only. This document specifies the Bluetooth Low Energy carrier for
the *same* protocol, so that field use can be one-handed and cable-free.

Nothing in the LSK protocol itself changes. Same `LSK HELLO` handshake, same
`LSK ID` / `LSK T` / `LSK F` / `LSK P` / `LSK OK` / `LSK ERR` lines, same
JSON bodies. Only the pipe changes.

## What exists today

- **Browser:** `webapp/src/lib/bleTransport.ts` implements this document in
  full — service discovery, notify subscription, MTU chunking, line
  reassembly, disconnect detection and reconnect — behind the
  `DeviceTransport` interface in `webapp/src/lib/deviceTransport.ts`, so it
  shares the handshake, reboot tolerance and retry budget in
  `webapp/src/lib/deviceLink.ts` with the Web Serial path. Covered by
  `webapp/src/lib/bleTransport.test.ts` against faked GATT objects.
- **Firmware:** nothing. `src/sim_main.cpp` drains `Serial` in `loop()` and
  writes every LSK line with `Serial.printf`. The `t-deck` PlatformIO
  environment pulls in no BLE stack (`platformio.ini` `lib_deps` is LVGL,
  TFT_eSPI, TinyGPSPlus, RadioLib), and no `NimBLE`, `BLEDevice`,
  `BLEServer`, `BLECharacteristic` or `esp_ble_*` symbol appears anywhere in
  `src/` or `include/`.
- **UI:** the connect sheet shows the Bluetooth option as unavailable and
  says the firmware does not support it yet, rather than offering a button
  that would always time out.

A firmware task is needed to close this. Until it lands, the honest state
is the one the app shows.

## The service

| Role | UUID |
| --- | --- |
| Primary service | `6c736b00-9c1d-4b7a-b3f2-1d0e5a7c4e10` |
| RX characteristic (browser → device) | `6c736b01-9c1d-4b7a-b3f2-1d0e5a7c4e10` |
| TX characteristic (device → browser) | `6c736b02-9c1d-4b7a-b3f2-1d0e5a7c4e10` |

The names are from the device's point of view, matching the Nordic UART
convention every ESP32 BLE example already follows: the device *receives* on
RX and *transmits* on TX.

These are the exact string constants exported as `LSK_BLE_SERVICE_UUID`,
`LSK_BLE_RX_CHARACTERISTIC_UUID` and `LSK_BLE_TX_CHARACTERISTIC_UUID` from
`webapp/src/lib/bleTransport.ts`. If the firmware picks different ones, both
sides must change together — Web Bluetooth cannot discover a service whose
UUID was not named up front.

### Advertising

The device must advertise:

- the primary service UUID above, in the advertising data (not only in the
  scan response), because Chrome's `requestDevice` service filter matches on
  advertised service UUIDs; and
- a local name beginning `Lilyshark`, because that is the second filter the
  picker offers and it is what a human recognises in the chooser.

`Lilyshark T-Deck` is the expected name. A board suffix is fine as long as
the prefix holds.

### RX characteristic — browser → device

- Properties: **write without response** (required), write (optional).
- The browser calls `writeValueWithoutResponse` when available.
- The device must accept a write of **1 to 20 bytes** on the default
  23-byte ATT MTU, and up to `MTU − 3` if it negotiates larger. The browser
  assumes 20 unless told otherwise, because Web Bluetooth does not expose
  the negotiated MTU to script.
- Writes carry a byte stream, not messages. One LSK line may span several
  writes; several short lines may share one write. The device reassembles on
  `\n` exactly as `loop()` already does for the CDC byte stream today.
- Every line the browser sends is terminated with a single `\n`. The device
  should also tolerate `\r\n`, which is what the existing CDC parser does.
- The device's existing 240-byte line buffer is the cap. A longer line is
  discarded, as on serial.

### TX characteristic — device → browser

- Properties: **notify** (required), read (optional).
- The device sends each notification with at most `MTU − 3` bytes of
  payload; 20 bytes is always safe.
- Notifications carry a byte stream, not messages, with the same rules:
  one line may span several notifications, several lines may share one, and
  every line ends with `\n`.
- The browser subscribes with `startNotifications()` immediately after
  discovering the characteristic and before sending its first `LSK HELLO`,
  so no line is lost between connect and handshake.
- Nothing may be sent before the browser subscribes; anything the device
  emits before the CCCD is written is dropped by the stack, so the device
  must not treat the connection as linked until it sees `LSK HELLO`.

### UTF-8

LSK bodies carry node names, which are arbitrary UTF-8. A chunk boundary may
fall inside a multi-byte character; the browser reassembler handles that
(streaming `TextDecoder`), and the firmware must not assume a chunk is a
valid string on its own.

## Session behaviour

The BLE link is a carrier for the same session the serial link carries:

1. The browser connects GATT, discovers the service, subscribes to TX.
2. The browser sends `LSK HELLO` and repeats it every 1.2 s until the device
   answers, giving up after 20 s (`HANDSHAKE_TIMEOUT_MS`).
3. The device answers `LSK ID {"app":"lilyshark","fw":"…","board":"t-deck"}`
   and sets `analyzer_link_active`, exactly as the serial path does.
4. While linked, the device streams `LSK T` every 2 s, `LSK F` per heard
   frame, and `LSK P` on a decoded Shelby pointer.
5. `LSK TX …` from the browser is answered with `LSK OK` or `LSK ERR`.
6. `LSK BYE` ends the session. The browser then disconnects GATT.

Because BLE is a shared connection rather than a re-enumerating CDC device,
the device must handle the browser disappearing without a `LSK BYE` — on
`gattserverdisconnected`, clear `analyzer_link_active` so telemetry stops
being generated for nobody.

## Reconnect

The browser treats a BLE drop exactly like a serial drop: up to three
attempts (`HANDSHAKE_MAX_ATTEMPTS`), a 4 s wait between them
(`REENUMERATE_WAIT_MS`), and a re-open on the same device object, which
Chrome allows without a second picker prompt once permission is granted.
That wait exists for the ESP32-S3 USB re-enumeration and is simply harmless
on BLE; keeping one retry policy is worth more than shaving four seconds off
a path nobody is watching.

The device therefore must accept a reconnect from the same central without a
reboot, and must not require a bond. Pairing is not part of this contract —
see below.

## Explicitly out of scope for v0

- **Pairing, bonding and encryption.** The link is deliberately open, like
  the USB one. LSK carries measurements and telemetry, not secrets; channel
  keys never cross it. If a future version carries anything private, this
  section is where the requirement lands, and it will need a matching change
  in the browser (`requestDevice` filters and a bonded-device flow).
- **Firmware update over BLE.** Flashing stays USB.
- **Bulk capture download.** `.lscap` transfer over BLE would need its own
  flow-controlled characteristic; today captures leave over USB or the SD
  card.

## Turning it on

When the firmware ships this service:

1. Flip `LSK_BLE_FIRMWARE_STATUS` in `webapp/src/lib/bleTransport.ts` from
   `'absent'` to `'advertised'` — that constant is the single place the
   claim lives, and a test asserts today's value so the change has to be
   deliberate.
2. The connect sheet's Bluetooth button enables itself from
   `bleLinkAvailability()`; no other UI change is required.
3. Update the "What exists today" section above.
