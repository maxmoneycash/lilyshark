# What you can actually see

Start here. This page answers the question every other document assumes you
already have an answer to: **what does Lilyshark show you, and what does it
refuse to show you?**

Everything below is what the shipped code does. Where a limit exists it is
stated as a limit, not softened.

## "Wireshark for LoRa" — what that means

Wireshark does not create traffic. It sits on a network you can already
reach, captures the frames crossing it, and explains each one field by
field: this is the header, this is the payload, this is the checksum, this
one is malformed.

Lilyshark is that instrument for LoRa mesh radio. A T-Deck's SX1262 is put
into receive on one channel, and every frame that lands is:

1. **recorded whole** — the raw bytes, exactly as heard;
2. **measured** — RSSI, SNR, frequency error, airtime, CRC pass or fail;
3. **explained** — as far as the protocol allows, and no further;
4. **saved** — to `.lscap` and to LoRaTap PCAP you can open in Wireshark itself.

The difference from Wi-Fi or Ethernet is that a LoRa mesh has no cable to
tap and no interface to put in promiscuous mode. The radio *is* the tap.
Anything transmitted within earshot on the channel you are tuned to is
yours to record — that is how radio works, and it is why a mesh needs
encryption at all.

**What Lilyshark never does:** transmit. It does not inject frames, does
not probe, does not join the mesh, does not acknowledge anything. It is a
receiver. The one thing it writes is your microSD card.

## Is mesh traffic encrypted? Can Lilyshark decrypt it?

This is the question that matters, and the honest answer has two halves.

### The half people find surprising

**Meshtastic ships every radio on Earth with the same channel key.** It is a
published constant in the Meshtastic source (`Channels.h`, `defaultpsk`); the
familiar `AQ==` channel shorthand selects exactly it. Its sixteen bytes are:

```
d4 f1 bb 3a 20 29 07 59 f0 bc ff ab cf 4e 69 01
```

The default **LongFast** channel — the channel most radios are on, out of the
box, forever — is encrypted with that key. Which means traffic on the default
channel is readable by anyone within radio range who bothers to apply a key
they already have.

Lilyshark applies it. On the default channel you get the actual message:

| What | Shown as |
| --- | --- |
| Text messages | the message text, up to 200 bytes, when the bytes are printable |
| Positions | latitude and longitude in degrees |
| Node info | long name (up to 40 chars) and short name (up to 8) |
| Telemetry, routing, traceroute, neighbor info | named port + payload length |
| Anything else | the port number, reported numerically rather than hidden |

That is not an attack on a cipher. Nothing here searches a keyspace or
exploits a weakness. It applies a key that is printed in public source code
and shipped in every device — and it stops the instant the result fails to
parse, because noise from a wrong key must never be dressed up as a message.

If you take one thing from this page: **the Meshtastic default channel is
not private.** Most people running it do not know that. Seeing your own
"encrypted" test message appear in a sniffer's frame list is the fastest way
to understand why you should set a real channel key.

### The other half

**A channel with a real PSK stays opaque.** If you or anyone else creates a
channel with an actual key, Lilyshark cannot read the payload, and does not
pretend to. You get the outer header and the RF measurements — nothing more.
The same is true of protected MeshCore payloads and IFAC-marked Reticulum
traffic.

There is no key cracking, no dictionary of keys, no key management at all.
That is a deliberate boundary, not a missing feature.

## What you get regardless of encryption

The physical layer is never encrypted, because it cannot be — a receiver has
to demodulate before there is anything to decrypt. So for **every** frame,
protected or not, you always get:

- frequency, bandwidth, spreading factor, coding rate
- RSSI and SNR
- frequency error
- airtime and payload length
- CRC valid, invalid, or absent
- capture timestamp and sequence

This is most of what a network problem actually looks like. "Nobody relayed
my message" is not a payload question — it is a question about whether a
frame appeared at all, from whom, at what signal strength, and whether its
CRC held.

## Per-protocol reality

| Protocol | Readable today | Stays opaque |
| --- | --- | --- |
| **Meshtastic** | Outer header — source, destination, packet id, channel hash, hop limit and start, next hop, relay byte, broadcast/ACK/MQTT flags. **Plus full payload on the published default key**: text, position, node names, port. | Any channel with a real PSK. |
| **MeshCore** | v1 route type, payload type, encoded path shape, transport codes, group channel, ACK checksum, structural length validation. | Protected direct, group, and anonymous payloads. Advertisement bodies are not expanded into contacts. |
| **Reticulum / RNode** | RNode shim, split marker, header type, packet and destination type, context, hops, hash prefixes, outer-header protection marker. | IFAC-marked content without an interface key. |
| **Unknown LoRa** | Raw bytes plus every RF measurement. | Everything else — and no protocol label is invented for it. |

Decoding is **profile-gated**, not automatic. These protocols do not all carry
an unambiguous magic value, so you tell Lilyshark which network you are
pointing it at (press `P` on the device) and it uses the matching structural
decoder. It will not guess and then lie about the guess.

## What you can't see

Being clear about this is the point of the tool.

- **Traffic on a channel you are not tuned to.** One SX1262, one channel at a
  time. A frame at 906.875 MHz is invisible while you sit on 910.525 MHz.
- **Traffic out of radio range.** A sniffer hears its neighbourhood, not the
  network. The mesh may be healthy three hops away while your view is empty.
- **Payloads under a real key.** Covered above.
- **Anything during a spectrum sweep.** The scan owns the single radio, so
  packet reception pauses visibly while it runs. Lilyshark says so on screen
  rather than showing a stale feed.
- **Wall-clock time.** The T-Deck has no dependable real-time clock, so
  capture timestamps are monotonic microseconds since boot. Order and
  intervals are trustworthy; absolute dates are not. Use relative-time
  columns in Wireshark.

## So why would you use it

Concretely, the situations it is built for:

**"My message didn't go through and I have no idea why."** The app shows
nothing either way. Lilyshark shows whether your frame went out, whether
anyone repeated it, and whether an ACK came back — turning "it's broken"
into "hop 2 never relayed it."

**"The mesh got slower as more people joined."** LoRa is ~1 kbit/s and
flood-routed; a few chatty nodes can eat the channel. Airtime and utilization
show who is spending it and how close to saturation you are.

**"Something is interfering and I can't see it."** 915 MHz is shared with
garage doors, sensors, and everyone else. The spectrum scan reads the
SX1262's own 33-bin power histogram across the band so you can find the
noise or move away from it.

**"One bad node is wrecking the network."** A radio with a wrong hop limit
or spamming position updates degrades everyone. Per-node stats and the event
log name it.

**"I need to prove what happened."** Captures are written to `.lscap` and
LoRaTap PCAP on microSD, and can be published to content-addressed storage
so the file's address is a hash of its bytes. A screenshot can be faked; that
cannot.

## Where to go next

- [Quickstart](quickstart.md) — evaluate it in ten minutes, no radio required
- [Lilyshark on real hardware](hardware.md) — what to expect on a real T-Deck
- [Architecture](architecture.md) — how capture, decode, and export fit together
- [Capture format](lilyshark-capture-format.md) — the `.lscap` layout

## Legal note

Rules on receiving and recording radio transmissions vary by country. You are
responsible for operating within the rules where you are. Lilyshark only
receives, but "only receiving" is not a defence everywhere, and the fact that
a key is published does not make every use of the traffic it protects lawful.
