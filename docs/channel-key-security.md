# Channel key security

Lilyshark can hold channel keys so its decoders can read traffic on channels
the operator is entitled to read. Keys are a liability as well as a feature, so
this page states exactly what the device does with them, and — more
importantly — what it does not.

The implementation is `include/lilyshark/core/channel_keys.h` and
`src/core/channel_keys.cpp`; the decoder side is
`src/core/meshtastic_payload.cpp`. The host tests that hold this document to
its word are `test/channel_keys/`.

## The short version

Keys are stored **in plaintext** in the device's flash. Physical possession of
a Lilyshark is disclosure of every key it holds. What the design does buy you
is that keys never leave the device through anything the firmware *produces* —
no capture file, no screenshot, no serial line — so sharing a capture or a
screenshot is safe in a way that handing over the device is not.

## What is stored, and where

| | |
| --- | --- |
| Capacity | 8 keys |
| Key size | 16 bytes (AES-128) only |
| Name | 1–15 printable ASCII characters, unique |
| Location | one NVS record, `keys`, in the `lilyshark` Preferences namespace |
| Record | magic `LSCK`, schema version, count, 8 fixed entries, CRC-32 |

Keys live in their own record rather than inside the `AppSettings` blob. That
blob is rewritten on every preference change — a brightness nudge, a capture
toggle, a remembered screen — and it is dumped during diagnostics. Key material
must not ride along with either, so it does not.

AES-256 channel PSKs are refused rather than stored. The firmware's cipher is
AES-128 (`crypto::kAes128KeySize`), so a 32-byte key would sit in flash forever
without ever being usable. The browser dissector
(`webapp/src/lib/dissect/meshtastic.ts`) does accept both sizes; the device is
the narrower of the two on purpose.

## CRC validation and rollback

The key record uses the same discipline as every other preference on the
device: a trailing little-endian CRC-32 over everything before it, computed by
the one shared routine in `include/lilyshark/core/settings_checksum.h`.

Loading refuses a record outright — `ChannelKeyDecodeResult::Invalid` — if the
magic, schema version, count, reserved bytes, name shape, trailing-entry
padding, or CRC-32 is wrong, and leaves the in-memory store exactly as it was.
There is no partial load. The cost of a torn write is the operator's key list;
it is never a key nobody entered.

Writes follow the rollback pattern the rest of the shell uses: mutate in
memory, attempt the write, and on failure restore the previous store and report
the failure as a runtime event. **Setup reset is the deliberate exception.**
"RUN SETUP AGAIN" clears the store and erases the record, and if the erase
fails the in-memory store *stays cleared* — the keys are unusable for the rest
of the session — and the event says plainly that a copy may remain in flash.
Restoring a secret because a write failed would be the wrong way round.

## What the storage does not give you

The T-Deck's ESP32-S3 supports flash encryption and NVS encryption. **This
firmware uses neither.** It ships the stock `default_16MB.csv` partition table
with an unencrypted `nvs` partition, no `nvs_keys` partition, no secure boot,
and no burned eFuses (`platformio.ini`, `[env:t-deck]`). Nothing in this build
derives a key from a passphrase, and there is no tamper response.

So the threat model is narrow, and this is all of it:

**In scope**

- Keys do not appear in `.lscap` files, PCAP files, BMP screenshots, the
  serial log, or the Shelby pointer.
- A corrupted or truncated key record is refused, never half-applied.
- A setup reset erases the keys.

**Out of scope**

- Anyone with the device in hand, or with a serial console on it. A
  `esptool.py read_flash` recovers every stored key; so does desoldering the
  flash. **Treat a lost Lilyshark as a disclosed key list and rotate the
  channel.**
- Any protection of the keys against another process on the device. There is
  no isolation boundary here to speak of.

## Why keys cannot reach a capture or a screenshot

The exclusion is structural, not a filter. A filter is a thing somebody forgets
to update.

- `.lscap` and PCAP records are serialised from `RawFrame` alone
  (`src/export/lilyshark_capture.cpp`, `src/export/pcap_loratap.cpp`).
  `RawFrame` has no key field and gains none. `DecodedPacket` — the struct that
  does record *which* key read a frame — is never written to either format.
- `DecodedPacket` carries `channel_key_slot`, an index, and the
  `AttributeStoredKeyReadable` bit. Nothing downstream of the decoder can learn
  more than "a key matched".
- A BMP screenshot is a dump of the framebuffer (`src/device/screenshot.cpp`),
  so anything on screen is in the file. Key bytes are therefore never drawn:
  entry is masked, and the key list shows a name and a fingerprint. There is no
  UI path that renders a key, so a screenshot has nothing to capture.
- `ChannelKeyProvider::channelKeyBytes()` is the one accessor that returns key
  material. Its only caller is the Meshtastic payload reader. Nothing that
  writes a file, draws a pixel, or prints a line calls it, and the name is
  greppable so that stays true.

`test/channel_keys/test_channel_keys.cpp` encodes a real capture record for a
frame that the device read with a stored key, and asserts that neither the key,
nor any four-byte run of it, nor the key's *name*, nor the recovered plaintext
appears anywhere in the bytes — and that the ciphertext still does.

## Fingerprints

The key list shows six hex digits taken from SHA-256 over a domain-separation
string and the key. It is one-way, and far too short to invert usefully. It
exists so an operator can tell two keys apart and confirm the one they typed
without ever putting key material on the screen.

## How decoding uses the keys

Meshtastic is the only protocol with key support today. Each payload is tried
against the **published default channel key first**, then against each stored
key in the operator's order — the same order the browser dissector uses.

The distinction survives all the way to the screen, because it is the whole
point:

- **DEFAULT KEY** — read with a key every Meshtastic radio ships with. No
  secret was needed and none was broken; the traffic was never private.
- **STORED KEY** — read with a key the operator entered. It claims only that
  whoever runs the analyzer knew the channel's secret.
- **NO KEY MATCH** — nothing read it. The bytes stay opaque, which is the
  honest outcome for a PSK nobody here has.

A wrong key produces noise, and noise is never presented as a message: the
plaintext must parse as a well-formed Data message or the key is skipped. The
decode fails closed to ciphertext.
