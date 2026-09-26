# What Lilyshark can show

Lilyshark is a developer alpha for examining supported LoRa mesh traffic. Its
T-Deck receiver listens on **one configured radio profile at a time**. It keeps
captured bytes alongside measurements the radio reports, applies the selected
protocol decoder, and can save `.lscap` and LoRaTap PCAP files to microSD. The
web analyzer opens captures, inspects packets, and compares two captures.

The code for several capabilities is complete enough to build and test on a
host, but a build is not a field result. The [README status table](../README.md#project-status)
records what was observed on two physical T-Decks and what still needs a
physical check. In particular, microSD writes, scan recovery, calibrated touch,
and live MeshCore and RNode reception remain unverified on hardware.

## Receiving and transmitting

The analyzer can listen without sending. The firmware also **transmits** when
the operator uses supported messaging, position, node-info, advertisement, or
raw-injection controls. A paired Meshtastic phone app can send messages through
the deck. Do not treat a messaging session as passive capture. Spectrum sweeps
also interrupt reception because the same SX1262 radio performs the scan.

The selected frequency, bandwidth, spreading factor, coding rate, sync word,
and preamble determine what can be heard. A quiet capture says only that this
receiver recorded nothing under those conditions. It cannot establish that a
whole mesh was silent or a remote hop failed.

## Payloads and privacy

| Traffic | What the implementation can show | Limit |
| --- | --- | --- |
| Meshtastic | Outer routing header; readable payloads on the published default channel key, including supported text, position, and node-info forms | A private channel needs its key. Modern public-key direct messages require the recipient's key material. |
| Meshtastic channel with an operator-supplied key | The T-Deck can store up to eight 16-byte channel keys and decode matching traffic | Keys are stored in plaintext in flash. The web dissector and device have different key support; see [channel key security](channel-key-security.md). |
| MeshCore | Structural route and payload fields; the web dissector also expands supported advertisements | Protected direct, group, and anonymous content stays opaque without the relevant key. Live over-air decoding awaits a sample captured on hardware. |
| Reticulum / RNode | Outer structure, supported clear LinkRequest and Proof fields, and supported unencrypted LXMF content | IFAC-marked or end-to-end encrypted content stays opaque without the relevant key. Live RNode reception awaits a hardware sample. |
| Unknown LoRa | Captured bytes and reported radio measurements | No protocol identity or plaintext is inferred. |

Decoding is tied to the selected profile. Matching a packet shape is not proof
that a decryption key was valid; the decoder must also parse the result. A
published shared key is not a privacy boundary. [Meshtastic's encryption
overview](https://meshtastic.org/docs/overview/encryption/) explains the
default channel and private channel model.

## RF evidence and its limits

The capture format can hold frequency, bandwidth, spreading factor, coding
rate, RSSI, SNR, frequency error, airtime, CRC state, timestamp, sequence, and
raw bytes. A particular record may lack a measurement; the analyzer displays
missing fields as missing rather than zero. The T-Deck capture clock is
boot-relative, so two devices need alignment before their timelines can be
compared. It is not a wall-clock timestamp.

The web analyzer's **Same Event** comparison uses identical bytes and **at
least two distinct shared payloads with agreeing time differences** to estimate
that alignment. With less evidence it leaves frames unpaired. Transmitted,
unknown-direction, and generated records cannot corroborate reception.
**Separate Visits** summarizes each
capture's received frames, reported radio settings, and measured signal
samples without pairing transmissions. Neither mode by itself proves a
network-wide delivery rate, receiver independence, or why a frame was missed.
Keep the original files and radio settings with any field conclusion.

The spectrum view reads the SX1262's 33-bin histogram at each scan step. The
scan path is experimental and its receive-restoration behavior still needs
physical validation. The single radio cannot receive packets while scanning.
LoRaTap PCAP also cannot encode every configured bandwidth; `.lscap` remains
the complete local capture format for those profiles.

## Stored files and stronger claims

The implementation writes `.lscap`, LoRaTap PCAP where representable, and BMP
screenshots to microSD. The byte-exact writers have host tests; microSD writes
and desktop opening of a card-produced file still need a physical run. A
content hash can show that bytes have not changed relative to a known hash. It
does **not** prove that a radio originally heard those bytes, that its location
was correct, or that two witnesses were independent. See the [Field Receipts
draft](protocol/field-receipts.md) for the proposed trust model.

## Start here

- [Quickstart](quickstart.md) opens a sample capture without a radio.
- [Hardware status](hardware.md) separates physical observations from simulated views.
- [Capture format](lilyshark-capture-format.md) documents `.lscap` fields.
- [Radio visibility](radio-map-visibility.md) explains what a map pin does and does not mean.

Radio reception, recording, and transmission rules vary by location. Operate
within the rules that apply to your equipment and region, and respect other
people's communications when sharing captures.
