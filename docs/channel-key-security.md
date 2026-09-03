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
  material. It has two callers: the Meshtastic payload reader, which opens a
  keyed frame, and the Meshtastic encoder, which seals a reply on the same
  channel. Both hand the bytes straight to AES and keep no copy. Nothing that
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

## Where the distinction is visible

Three screens show a decoded Meshtastic message, and each of them names the key
that opened it. A stored key is drawn in amber — the same shade a frame relayed
over the internet bridge wears, this firmware's mark for a result with a caveat
attached — while the published default key keeps lime, because it carries the
stronger claim that the traffic was never private.

- **Packet detail, DECODE tab** — `PORT TEXT  KEY NORTH RIDGE`, against
  `PORT TEXT  DEFAULT KEY` for a public one. The decoder library only ever
  tries the default key, so a frame a stored key opened reaches this screen
  labelled OPAQUE / HEADER; the screen states what the deck as a whole made of
  the frame instead, since printing HEADER above a message it is displaying
  would be the wrong kind of honest.
- **Messages** — the key's name follows the sender and the route, and the
  row's edge marker turns amber.
- **Chat** — each stored key owns a conversation of its own, titled with the
  key's name, drawn amber from the tab down to the box you type in, and
  stamped in the corner with the key's fingerprint. A chat line records the
  key's *name* for display and its *fingerprint* for identity: the name
  because the line outlives the key list, and the fingerprint because a name
  can be typed twice. A line belongs to a thread only when the fingerprints
  match exactly, which is what keeps a keyed message out of EVERYONE and an
  EVERYONE message out of a keyed thread — in both directions, on every line.

The name, never the bytes: a decode result carries a slot index and the slot is
resolved to the name the operator typed.

One decode deliberately does **not** use stored keys. The USB link to
lilyshark.com emits a JSON summary per heard frame, and that record has no
field for which key opened it — so a borrowed key's plaintext sent down it
would arrive looking exactly like traffic anybody within earshot could read.
The raw frame still goes over the link, so nothing is hidden from the analyzer;
it simply does not get a decode it cannot label.

## Answering on a keyed channel

Reading a channel and speaking on it are different acts, and for a long time
this firmware could only do the first. Keyed text was deliberately kept out of
Chat: Chat has a Send button, and the encoder could only ever seal with the
published PSK, so a reply composed beside a private message would have gone out
in public, into a conversation the operator believed was private.

`encodeMeshtasticFrame` now takes the channel key and the channel name, and one
pointer decides both halves of the frame:

- the body is sealed with that key instead of `kMeshtasticDefaultPsk`;
- the header's channel byte becomes `meshtasticChannelHash(name, key)`, the XOR
  of the two, which is the same byte every stock radio on that channel stamps.

A request that names no key is byte-for-byte what it always was. The test
`testDefaultChannelFramesAreByteForByteUnchanged` holds two frames captured
from the previous revision of the encoder and compares them to what it produces
today, so the public channel cannot be broken by a change made for a private
one.

**The key's name is the channel's name.** The hash covers both, so a key stored
under any other label still seals correctly, still cannot be read from outside
the channel, and still reaches nobody: every stock node drops the frame on the
header byte before decrypting it. Reading works under any name. Sending does
not. The naming screen says so.

**Acknowledgements.** A want-ack packet opened by a stored key is answered
under that same key, or not at all. A default-key acknowledgement would
broadcast in the clear both that this deck holds the channel's key and which
packet it just read; a keyed one says neither, because the confirmed id is
inside the ciphertext and the header byte is the channel's own. The ack goes
out only when the header byte the deck would stamp equals the header byte the
frame it answers arrived carrying — the only evidence available on the air that
the operator's name for the key is the name the channel goes by. When they
differ the deck stays silent, which is what it did before.

**What a keyed conversation is not.** It addresses the channel, never a person,
even when the frame that started it was addressed to this node alone. A channel
key is shared by everyone holding it, so such a message was never private to
its recipient, and offering a one-to-one reply thread for it would draw a
privacy the key does not provide. A node heard only under a borrowed key gets
no direct-message tab for the same reason: that tab's Send button would answer
under the public key.
