# MeshCore participation plan

Lilyshark already decodes MeshCore frames off the air. This plan is the wire
truth and build order for the next step: the deck joining the MeshCore network
as a first-class node — advertising an identity, learning paths, exchanging
direct messages with acknowledgements, and speaking on group channels.

Everything in this document was read from executable sources, not memory:

| Source | What it proves | Pinned at |
| --- | --- | --- |
| `webapp/node_modules/@liamcottle/meshcore.js/src/` | packet framing, advert layout, companion protocol | v1.14.0 (vendored) |
| github.com/meshcore-dev/MeshCore `src/` + `lib/ed25519/` + `src/helpers/` | crypto primitives, packet construction, routing behaviour, radio config | commit `0679dbef` (2026-08-24) |
| `src/core/meshcore_decoder.cpp`, `src/core/builtin_profiles.cpp` | what Lilyshark already parses and the RF profile it listens on | this repo |

The golden advert vector in Stage 1 was generated with MeshCore's own vendored
ed25519 C library and independently verified by meshcore.js (`@noble/curves`),
so two unrelated implementations agree on every byte before we write any C++.

## 1. What participation requires on the wire

MeshCore is connectionless flood routing over raw LoRa frames. A participating
node needs exactly five behaviours:

1. **Identity**: a persistent Ed25519 keypair. The public key IS the address;
   its first byte is the node's path hash.
2. **Advert**: periodically flood a signed `ADVERT` packet so other nodes
   discover us and learn our name/position.
3. **DMs**: encrypt `TXT_MSG` payloads to a contact with an ECDH shared
   secret, track the expected `ACK`, and acknowledge inbound messages.
4. **Paths**: answer a flood-routed DM with an encrypted `PATH` return so the
   peer can switch to direct routing, and store the paths peers send us.
5. **Channels**: encrypt/decrypt `GRP_TXT` under a shared channel PSK
   (the well-known Public channel works out of the box).

We participate as a **leaf node**: `Mesh::allowPacketForward()` defaults to
false in MeshCore itself, so not repeating other nodes' traffic is spec-level
correct behaviour, keeps our airtime tiny, and cannot corrupt anyone's routes.
Repeater behaviour is explicitly out of scope.

## 2. Radio layer: already aligned

`builtin_profiles.cpp` profile 2 ("MESHCORE US", 910.525 MHz, 62.5 kHz, SF7,
CR5, sync 0x1424) matches MeshCore's current USA/Canada recommendation, and
the RX side has been decoding live traffic with it. The TX-relevant facts,
verified against `CustomSX1262.h` and `RadioLibWrappers.h`:

- Sync word `RADIOLIB_SX126X_SYNC_WORD_PRIVATE` (0x12, i.e. register value
  0x1424 — what our profile already stores).
- CRC on, explicit LoRa header, no IQ inversion.
- Preamble: `sf <= 8 ? 32 : 16` symbols (`preambleLengthForSF`). Our
  `derivePreambleSymbols` already implements exactly this rule for MeshCore
  profiles.
- MeshCore never transmits blind: it checks `isReceiving()` (preamble/header
  activity) before TX and retries after 200 ms on a busy channel, with a 4 s
  cap. It also keeps an airtime duty-cycle budget. We should mirror the
  channel-activity check with a simple pre-TX poll of the SX1262 (we already
  own the DIO1 path) and a bounded retry, but a full budget ledger is not
  needed at our packet rates.

`TDeckRadioService::transmit()` exists and is proven by the Meshtastic path.
No radio work is required beyond the pre-TX politeness check.

## 3. The exact bytes Lilyshark must emit

### 3.1 Outer frame (all packets)

```
header[1] | (transport_codes[4] if route 0/3) | path_len[1] | path[N] | payload[...]
```

- `header`: bits 0-1 route (0 TRANSPORT_FLOOD, 1 FLOOD, 2 DIRECT,
  3 TRANSPORT_DIRECT), bits 2-5 payload type, bits 6-7 payload version
  (must be 0 = v1: 1-byte src/dest hashes, 2-byte MAC).
- `path_len`: bits 0-5 hash count (max 63), bits 6-7 hash size minus one.
  Fresh flood packets go out with `path_len = 0x00`; repeaters append their
  hash as they forward, which is how the sender's return path gets built.
  Size code 3 (4-byte hashes) is reserved and rejected.
- Max on-air frame 255 bytes; max payload 184 bytes; max path 64 bytes.

This is byte-identical to what `meshcore_decoder.cpp` already parses, so every
encoder gains a free self-test: encode, run through our own decoder, compare
fields. That property held for the Meshtastic encoder and caught real bugs.

### 3.2 ADVERT (payload type 4)

```
payload = pub_key[32] | timestamp[4 LE] | signature[64] | app_data[<=32]
app_data = flags[1] | (lat[4 LE] lon[4 LE] if flags&0x10) |
           (feat1[2] if flags&0x20) | (feat2[2] if flags&0x40) |
           (utf8 name, unterminated, if flags&0x80)
```

- flags low nibble = node type: 1 CHAT is us (2 REPEATER, 3 ROOM, 4 SENSOR).
- lat/lon are `int32(degrees * 1e6)`.
- timestamp is epoch seconds. Receivers drop an advert whose timestamp is
  `<=` the last one they stored for that key ("check for replay attacks" in
  `BaseChatMesh::onAdvertRecv`), so our advert clock must be strictly
  increasing across reboots — see the clock work in §4.
- **signature is Ed25519 over `pub_key ‖ timestamp ‖ app_data`** (not over
  the packet header, not over the signature bytes).
- Flood advert header = 0x11; zero-hop (neighbours only) is route DIRECT with
  empty path, header 0x12. Companion firmware sends zero-hop by default and
  flood on explicit "Advert (flood)".

Golden vector, generated with MeshCore's vendored ed25519 and verified by
meshcore.js `Advert.isVerified()` → true (test-client keypair from
`Identity.cpp::validatePrivateKey`, timestamp 0x68b00000, name "LSK1"):

```
11 00 1ec77175b0918ed206f9ae04ec136d6d5d4315bb26305427f645b492e9350c10
00 00 b0 68 542b627d72e15a2b15e575b3f9f713e3af3f110ef1f32d67d8b7a10d89
9ed9a1fc399b3b9735b9683db8f95b341ab66ceb74374a00dc685d28afef5f2816f6 00
81 4c 53 4b 31
```

(The Ed25519 signature is deterministic — RFC 8032, no random nonce — so this
exact frame must fall out of our implementation given the same inputs.)

Re-confirmed before stage 1 was written, from three directions: the RFC 8032
appendix reference implementation reproduces these bytes from the test-client
private key; `Advert.isVerified()` in meshcore.js returns true for the frame,
which runs `@noble/curves` over it; and `encodeMeshCoreAdvert()` now emits it
byte-for-byte in `test/meshcore_tx`.

### 3.3 Crypto primitives for everything below

From `Utils.cpp` and `Identity.cpp` — these are the interop-critical choices
and none of them are negotiable:

- **Shared secret**: `ed25519_key_exchange(secret, their_ed25519_pub, our_prv)`
  from orlp/ed25519 — converts the Edwards public key to a Montgomery
  u-coordinate (`u = (1+y)/(1-y)`) and runs the X25519 ladder with the
  clamped low 32 bytes of the 64-byte expanded private key. Output is the
  **raw 32-byte x-coordinate, not hashed**.
- **Encrypt**: AES-128-**ECB**, block by block, final block zero-padded.
  Key = first 16 bytes of the shared secret.
- **MAC**: HMAC-SHA256 over the **ciphertext**, keyed with the **full
  32-byte shared secret**, truncated to **2 bytes**, **prepended**:
  `dest = MAC[2] | ciphertext[16n]` (`encryptThenMAC`).
- **Decrypt**: recompute HMAC over ciphertext, compare 2 bytes, then AES-ECB
  decrypt (this needs the AES **inverse cipher**, which our CTR-only
  `aes128.cpp` deliberately omits today).
- Group channels use the same `encryptThenMAC` with the channel secret in
  place of the ECDH secret. The secret field is 32 bytes; a 128-bit PSK sits
  in the first 16 with the rest zero, and the HMAC key is still the full
  32-byte field (zeros included) while AES uses the first 16.

ECDH cross-check vector (both directions agree; from the generator program):
test-client keypair × keypair from seed `0x42`*32
(`peer_pub 2152f8d19b791d24453242e15f2eab6cb7cffa7b6a5ed30097960e069881db12`)
→ `shared_secret 2188e7159ecbd406db766e7eb0e523e92da0ff0ac6d25713890042c577871373`.

### 3.4 TXT_MSG direct message (payload type 2)

```
payload = dest_hash[1] | src_hash[1] | MAC[2] | ciphertext[16n]
plaintext = timestamp[4 LE] | flags[1] | utf8 text (<=160 bytes)
```

- `dest_hash`/`src_hash` are the first byte of each party's public key.
- `flags = (attempt & 3) | (txt_type << 2)`; txt_type 0 = plain text.
  attempt bumps per retry so the packet hash (dedup key) changes.
- Send flood (header 0x09) while the contact's out-path is unknown; send
  direct (0x0A) with the stored path once a PATH return arrives.
- **Expected ACK** (computed by the sender at send time): first 4 bytes of
  `SHA256(plaintext[0..5+text_len] ‖ sender_pub_key[32])`. The recipient
  computes the same over the decrypted bytes and the *sender's* key, so both
  sides derive the same 4-byte code without another exchange.
- Receivers try all contacts whose key starts with `src_hash` until one
  secret passes the MAC (1-byte hashes collide; the scan loop is mandatory,
  `MAX_SEARCH_RESULTS` 8 in stock firmware).
- Receivers zero-terminate at `data[len]`, so trailing ECB padding is
  harmless, but we must never rely on padding bytes being present.

### 3.5 ACK (payload type 3)

`payload = ack_code[4]` (+ up to 2 salt bytes stock firmware appends to make
the packet hash unique; matchers only read the first 4). Sent on the reverse
path direct when known, else flood. When an inbound flood DM needs both an
ACK and a path, stock firmware folds the ACK into the PATH return (§3.6)
instead of sending both.

### 3.6 PATH return (payload type 8)

Answer to any flood-routed DM/REQ so the peer can go direct:

```
payload = dest_hash[1] | src_hash[1] | MAC[2] | ciphertext
plaintext = path_len[1] | path[N] | extra_type[1] | extra[...]
```

- `path` is the accumulated hop list from the packet we just received —
  i.e. the route TO us — encrypted so only the peer learns it.
- `extra_type = PAYLOAD_TYPE_ACK` with the 6-byte ack as `extra` is how a
  flood DM gets acknowledged and path-taught in one packet. With nothing to
  piggyback, stock firmware sends `extra_type 0xFF` + 4 random bytes.
- On receiving a PATH addressed to us: store `path` as the contact's
  out-path, process any piggybacked ACK, and (per `Mesh::onRecvPacket`) when
  it arrived flood-routed, send a reciprocal PATH back **direct** along the
  path we just learned.

### 3.7 GRP_TXT channel message (payload type 5)

```
payload = channel_hash[1] | MAC[2] | ciphertext
plaintext = timestamp[4 LE] | 0x00 | "SenderName: message text"
```

- `channel_hash` = first byte of `SHA256(psk_bytes)` (hash over 16 bytes for
  a 128-bit key, 32 for a 256-bit one).
- The sender's display name travels inside the plaintext as a `name: ` prefix
  — there is no source field at the packet layer.
- Well-known Public channel PSK (base64): `izOH6cXN6mrJ5e26oRXNcg==`
  (16 bytes), pre-configured in stock companion firmware.
- Always flood-routed; no ACKs on channels.

### 3.8 Routing/dedup obligations on receive

- Keep a seen-packet table keyed on `SHA256(payload_type ‖ payload)[0..7]`
  (`calculatePacketHash`) and drop duplicates; mark our own transmissions
  seen so our flood does not bounce back at us.
- Never retransmit: we are a leaf. This also sidesteps every path-poisoning
  hazard of a sniffer that injects.
- ACK matching: on `PAYLOAD_TYPE_ACK` (or piggybacked in PATH), compare the
  first 4 bytes against outstanding expected-ack codes; on match mark the
  message delivered (mirrors the existing Meshtastic DELIVERED flow).

## 4. Have vs. need

Already in the tree and proven:

- **Frame parsing** — `meshcore_decoder.cpp` validates the exact layouts
  above (it was written from the same `Packet.h`); adverts, ACK checksums,
  path fields, transport codes all come out typed.
- **AES-128 forward cipher** — `crypto/aes128.cpp`, FIPS-197-tested, host +
  device. ECB encrypt is a direct reuse of `Aes128::encryptBlock`.
- **Radio TX + MeshCore RF profile** — `TDeckRadioService::transmit`,
  profile 2, preamble/sync/CRC already MeshCore-correct.
- **Chat UI, contact-ish UI, NVS settings machinery, GPS position** — the
  Meshtastic chat/DM/ACK experience gives the interaction pattern and
  storage precedent (chat archive v2 in NVS).
- **A live test bench** — the webapp is already a MeshCore companion client
  (meshcore.js), so a stock MeshCore node attached over USB/BLE can verify
  every stage from the other side of the air gap.

Missing, in dependency order:

1. **SHA-256 + HMAC-SHA256** (~3 KB flash). New `src/crypto/sha256.cpp` in
   the same self-contained, host-tested style as `aes128.cpp` (FIPS 180-4 +
   RFC 4231 vectors). Also unlocks channel hashes and expected-ACK codes.
2. **AES-128 inverse cipher** (~1.5 KB). Add `decryptBlock` to `Aes128`;
   the header's "encryption only" comment gets revised because MeshCore's
   ECB needs the real inverse, unlike Meshtastic's CTR.
3. **Ed25519 signatures** — *landed with stage 1*. `src/crypto/ed25519.cpp`
   plus `include/lilyshark/crypto/ed25519.h` provide seed expansion,
   public-key derivation from a stored expanded key, signing and
   verification. They pass the RFC 8032 section 7.1 vectors and reproduce
   MeshCore's own known-good test-client keypair from `Identity.cpp`.

   This replaces the plan's original instruction to vendor orlp/ed25519 out
   of the MeshCore tree. What landed instead is the crypto_sign half of
   TweetNaCl (public domain, tweetnacl.cr.yp.to), translated into the same
   house style as the already-vendored `curve25519.cpp`, which is the
   crypto_scalarmult half of that same library. The two implementations are
   interchangeable on the wire: both are RFC 8032, both clamp an expanded key
   to the same bit pattern, and Ed25519 signatures are deterministic, so the
   golden advert vector in `test/meshcore_tx` — generated with an independent
   RFC 8032 reference implementation and confirmed by meshcore.js running
   `@noble/curves` — comes out byte-for-byte identical either way.

   The reason for the swap is size. orlp carries precomputed base-point
   tables and measured 69,946 bytes of text; TweetNaCl has no tables and
   compiles to **7,346 bytes of Xtensa `.text`, zero data, zero bss**
   (`xtensa-esp32s3-elf-size` on `.pio/build/t-deck/src/crypto/ed25519.cpp.o`
   from the gate's own T-Deck build), on a build that is already two thirds
   map tiles. `meshcore_encode.cpp.o` is another 899 bytes. Both are object
   sizes: nothing calls them yet, so the linker may drop them from today's
   image entirely, and the real image delta arrives with the wiring in §8.
   The price is speed: without a base-point table,
   signing is a full 256-bit ladder. That is fine for an advert emitted once
   a minute at most, and it is *not* obviously fine for verifying a burst of
   inbound adverts in stage 2 — measure before putting verification on the
   LVGL loop task, and honour §7's one-advert-per-tick mitigation. TweetNaCl
   is public domain, which is why neither this file nor `curve25519.cpp`
   needs a `NOTICE.md` entry.

   - **Still missing: `ed25519_key_exchange`.** Stages 3 to 5 need the
     Edwards→Montgomery conversion (`u = (1+y)/(1-y)`) followed by the X25519
     ladder over the clamped low half of the expanded key, producing the raw
     unhashed x-coordinate (§3.3). Nothing in the tree exposes that yet:
     `curve25519.cpp` has the ladder but wants a Montgomery u-coordinate, and
     `ed25519.cpp` has the field arithmetic for the conversion but no entry
     point. It is a few lines over either file's `Gf` layer, and the §3.3
     cross-check vector is its acceptance test.
   - **Known duplication.** `ed25519.cpp` and `curve25519.cpp` each carry
     their own copy of the roughly hundred lines of GF(2^255-19) arithmetic
     they both inherited from TweetNaCl, because they landed under separate
     ownership. Folding them together is a cleanup for whoever holds both
     files next, and the natural place to add the key exchange above.
4. **Epoch clock** — *the advert half landed with the stage 1 wiring.* Frames
   carry epoch seconds and peers enforce per-identity monotonicity.
   `meshCoreNextAdvertTimestamp()` plus the reserved NVS floor described in
   §8 item 2 give adverts a value that only ever increases, which is all a
   receiver's replay check tests. What is still missing is a real wall clock:
   the firmware otherwise keeps only monotonic microseconds, so an advert's
   timestamp is a plausible-looking counter, not the time. Sources in priority
   order when that matters — inbound DM timestamps in stage 3 are read by
   humans — are GPS UTC (already parsing NMEA via TinyGPSPlus, but
   `hardware_status` does not expose the time field yet) and a user or
   webapp-set time over the serial link, both feeding the same persisted floor.
5. **MeshCore node state**: identity (64 B expanded private key) in NVS;
   contact table (pub key,
   cached shared secret, out-path, name, last-advert timestamp ≈ 176 B per
   contact, 32 contacts ≈ 5.6 KB); seen-packet ring (~2 KB); outstanding-ack
   list; a small delayed-TX queue (MeshCore staggers replies: ACKs +200 ms,
   flood retransmit jitter — we need the delay slots, not the priorities).
6. **`meshcore_encode.{h,cpp}`**: real builders mirroring
   `meshtastic_encode`'s shape: pure functions, fixed buffers, no
   allocation, host-testable. The advert builder
   (`encodeMeshCoreAdvert`, `encodeMeshCoreAdvertAppData`,
   `encodeMeshCoreAdvertSignedMessage`, `meshCoreDegreesToMicros`,
   `meshCoreNextAdvertTimestamp`) landed with stage 1; §3.4 text messages,
   §3.5 ACKs, §3.6 path returns and §3.7 channel messages are still to write,
   and each of them needs the crypto from item 1 to 3 above that has not
   landed yet.

## 5. Staged build plan

Each stage lands green through `./scripts/test_all.sh` and, where UI pixels
change, the golden-hash regen dance. Stages are sized so each is one PR with
one on-air milestone.

**Stage 0 — crypto foundations (no behaviour change).**
`sha256.cpp` (+HMAC), `Aes128::decryptBlock`, vendored ed25519, and a
`meshcore_crypto.cpp` gluing them into `encryptThenMAC`/`MACThenDecrypt` and
`sharedSecret`. New host suites: FIPS/RFC vectors, the §3.3 ECDH vector, the
MeshCore test-client keypair round-trip (sign→verify, exchange both ways),
and RFC 8032 sign vectors. *Milestone: host tests prove byte-agreement with
the vectors above; device build still links and fits.*

**Stage 1 — identity + advert TX. "A stock MeshCore companion app/node sees
our advert."**
Generate the keypair from `esp_random` on first boot, persist in NVS,
surface the key prefix in ABOUT. Implement `encodeMeshCoreAdvert` (flags
CHAT|NAME, lat/lon when GPS fix and sharing enabled), the epoch-clock floor,
and a manual "announce" action plus a conservative auto-advert (zero-hop by
default, flood on user request — matching stock companion defaults).
Tests: the golden advert vector byte-for-byte with the test keypair pinned;
round-trip through our own `MeshCoreDecoder`; timestamp-floor persistence.
*Milestone: a stock node (webapp companion attached to a real MeshCore
device, or a phone running the MeshCore app near the deck) shows
"Lilyshark-XXXX" as a new contact with a valid signature.*

*Status: wired and transmitting; no stock node has confirmed reception.*
`src/crypto/ed25519.cpp` and `src/core/meshcore_encode.cpp` build a complete
signed advert, and `test/meshcore_tx` pins the golden vector byte-for-byte
along with a located variant, the 32-byte maximum app data, UTF-8 name
truncation, the advert-clock rule, and a round trip back through
`MeshCoreDecoder` that re-reads every field from the decoded frame and
re-verifies the signature.

`src/sim_main.cpp` now mints an Ed25519 identity from `esp_random` on first
boot and persists it, keeps the monotonic advert clock of §8 item 2, advertises
zero-hop on arriving at a MeshCore profile and every fifteen minutes after
that, and answers `LSK TX meshcore advert` (`... advert flood` for the explicit
flooded form) over USB. `kMeshCoreTransmitReady` is now true, and it means the
path is wired — not that anything on the far side has heard it.

Still absent from stage 1 as written: the ABOUT surface for the key prefix, and
the pre-TX channel-activity check of §2, which needs an `isReceiving()` on
`TDeckRadioService` that does not exist yet. At one 0.37 s advert per fifteen
minutes the deck is at 0.05 % duty, so the missing check costs the band very
little, but it is the difference between polite and provably polite and it
should land before the advert interval is ever shortened. The open milestone is
the one below: a stock node listing this deck.

**Stage 2 — advert RX → contact table.**
Verify inbound advert signatures (ed25519_verify), enforce the replay rule,
populate the contact table, show MeshCore nodes with names in the existing
node UI instead of bare hashes. *Milestone: a nearby stock node's name and
position appear on the deck, and a re-played old advert does not.*

**Stage 3 — DMs + ACKs, flood only.**
`composeMeshCoreTextMessage` (§3.4), expected-ack bookkeeping, inbound DM
decrypt with the multi-candidate `src_hash` scan, auto-ACK via PATH-return
piggyback for flood receipts (§3.6, which stage 4 completes — at this stage
send the plain flood ACK), chat UI wiring with DELIVERED on ack match.
Tests: full DM vector against a fixed keypair + fixed timestamp, MAC-reject,
padding handling, ack-code derivation on both roles.
*Milestone: two-way DM exchange with a stock companion node, DELIVERED
showing on both ends.*

**Stage 4 — PATH returns + direct routing.**
Emit PATH returns for flood DMs (ACK piggybacked), store learned out-paths,
switch sends to direct with stored path, handle reciprocal-path and
path-reset (fall back to flood after N direct sends without an ack).
*Milestone: with a repeater between deck and peer, the second DM leaves as
route DIRECT carrying the learned hop hash, visible in our own sniffer log.*

**Stage 5 — channels.**
Public channel preconfigured (§3.7); channel post/receive in the chat UI
under a channel tab; PSK entry deferred to the webapp config path.
*Milestone: deck message appears in a stock app's Public channel and a phone
message appears on the deck.*

Every stage keeps the sniffer role intact: our own TX is ingested as a
`FrameDirection::Transmit` frame exactly like the Meshtastic path does, so
captures stay honest, and net-injected frames (`FrameOrigin::Net`) stay
barred from RF re-emission.

## 6. Flash and RAM budget

Measured base (t-deck ELF built 2026-09-02, `xtensa-esp32s3-elf-size`, and
confirmed by the `platformio run -e t-deck` size report in the same gate run):
static RAM 252,644 B (data 47,644 + bss 205,000) = **77.1 %** of 327,680 B
DRAM. Flash against the 6,553,600 B OTA app slot depends on baked map tiles:
1,580,501 B = **24.1 %** without them (clean checkout), 4,453,653 B =
**68.0 %** with the current tile set, and full-tile builds have hit ~4.97 MB
≈ 75.8 %. Tiles are the swing; code is the small stable part.

Additions, worst case:

| Item | Flash | Static RAM |
| --- | --- | --- |
| ed25519, TweetNaCl (measured: `ed25519.cpp.o` text on Xtensa) | 7.2 KB | 0 |
| advert encoder (measured: `meshcore_encode.cpp.o` text) | 0.9 KB | 0 |
| SHA-256 + HMAC | ~3 KB | 0 |
| AES inverse cipher | ~1.5 KB | ~0 |
| remaining encoders + node state machine + UI glue | ~8 KB | — |
| contacts (32×176 B) + seen ring + queues + identity | — | ~10 KB |
| **Total** | **~21 KB (+0.3 % of slot)** | **~10 KB (+3.0 %)** |

The first two rows are measured against the built objects; the rest are still
estimates. Dropping orlp for TweetNaCl (§4 item 3) is what took this from the
~83 KB this table originally carried down to ~21 KB.

**What stage 1's wiring actually cost**, measured by building this branch and
its parent commit back to back with the same pinned toolchain (`platformio run
-e t-deck`, no baked tiles in either):

| | Flash | Static RAM |
| --- | --- | --- |
| parent commit | 1,596,685 B (24.4 %) | 253,780 B (77.4 %) |
| with the advert wiring | 1,604,629 B (24.5 %) | 253,900 B (77.5 %) |
| delta | **+7,944 B** | **+120 B** |

The flash delta is almost entirely the two objects the first two rows measured:
until something called them the linker was dropping them from the image, which
is what that note predicted. The RAM delta is the identity (96 B) plus the
clock and pacing counters, and nothing else — the advert frame is a stack
buffer in the sender.

Flash lands well under 69 % (under 77 % even on a full-tile build) — comfortable.
Static DRAM goes from 77.1 % to ~80 % against ~75 KB of headroom — tight but
workable; if the contact table grows past 32 entries it moves to PSRAM
(BOARD_HAS_PSRAM is already on) rather than DRAM. Crypto stack spikes are a
RAM concern too: MeshCore's own comments put software Ed25519 verify near
3 KB of stack, so signature verification runs from the main loop only after
checking headroom with `uxTaskGetStackHighWaterMark`, else on a short-lived
worker task.

## 7. Risks

- **Clock discipline is interop-critical.** Peers silently drop adverts with
  non-increasing timestamps, and there is no error to observe. The persisted
  timestamp floor (§4.4) must land with Stage 1, not after; a field-debug
  session where the deck "adverts but nobody sees it" is otherwise
  guaranteed the first time the RTC starts from zero.
- **ECB + 2-byte MAC is weak crypto we must copy anyway.** Identical
  plaintext blocks leak, and a 2-byte MAC means 1-in-65536 forgeries pass.
  This is MeshCore v1's documented format; we implement it bit-exactly for
  interop and simply avoid claiming security properties in UI copy. Payload
  version bits exist (v2 reserves bigger hashes/MACs) — our decoder already
  refuses to guess future versions, and the encoder pins version 0.
- **1-byte address hashes collide.** Both DM decrypt (scan all matching
  contacts) and inbound-for-us checks must tolerate collisions; a naive
  first-match implementation works in testing and fails in a real mesh.
- **Signature latency on the S3, now the bigger of the two costs.** The
  TweetNaCl signer that landed trades speed for the 60 KB of flash orlp's
  precomputed tables would have cost, so a sign is one full 256-bit ladder
  and a verify is two. Neither has been timed on hardware yet — that
  measurement is a prerequisite for stage 2, not an afterthought. Doing
  verify inline for a burst of adverts could stutter the UI loop.
  Mitigation: verify at most one advert per loop tick from a small queue,
  and move signing off the render path if a measured sign exceeds a frame.
- **Airtime etiquette.** Flood adverts are de-prioritised by stock nodes and
  duty budgets exist for a reason; our defaults (zero-hop advert, no
  forwarding, single ACK, jittered reply delays of 200-300 ms per stock
  constants) keep the deck a polite citizen at SF7/62.5 kHz where airtime is
  cheap but the community is active.
- **Verification depends on a stock counterpart.** Stage milestones need a
  real MeshCore node (phone app or companion device). The webapp's existing
  companion client covers the far end when one is available; until then the
  meshcore.js cross-check (already exercised for the golden vector) is the
  stand-in, and it validates bytes, not RF behaviour.
- **RAM ceiling.** At 77 % static DRAM before we start, any accidental
  static buffer (a second 184-byte packet pool, a debug ring) matters.
  Budget review per stage against the `-A` section sizes, and prefer PSRAM
  for anything that grows.

## 8. Wiring stage 1 into the firmware

`encodeMeshCoreAdvert()` is a pure function over a caller-owned buffer. Five
things had to exist around it before a deck could advertise. Four of them are
now in `src/sim_main.cpp`; this section records what each one turned into,
because the reasoning is what a reviewer needs and the code cannot show it.

**1. An identity in NVS — landed.** `load_or_create_meshcore_identity()` draws
32 bytes from `esp_random` on first boot and calls
`crypto::ed25519CreateKeypair(pub, prv, seed)`. Only the 64-byte expanded
private key is persisted, under the NVS key `mcid`, following the same blob
pattern and the same all-or-nothing rule as `load_or_create_pkc_identity()`
directly above it: an identity that cannot be stored is zeroed and refused,
because peers file us under the key they first heard and a key this deck
forgets at the next power cycle makes every reconnection a new stranger.
`ed25519DerivePublicKey()` recovers the public key on load, so the public half
is a cache and not a second source of truth — the same fallback
`LocalIdentity::readFrom` has, and one fewer stored fact to go stale. A derived
public key starting `0x00` or `0xFF` is refused and regenerated, because
MeshCore's `validatePrivateKey` rejects those prefixes: the first byte is the
node's path hash and both values are reserved. The seed is never stored; the
expanded key is all that signing or, later, key exchange needs.

**2. A strictly increasing epoch clock — landed, as a reservation.** §4 item 4
and §7's first risk are the same problem, and it is the one most likely to
waste a field session. `meshCoreNextAdvertTimestamp()` in `meshcore_encode.cpp`
is MeshCore's `getCurrentTimeUnique()` rule — the persisted floor plus seconds
since boot, never less than one more than the last value emitted — as a pure
function with its own host tests, saturating at 2106 rather than wrapping.

What sits around it is a *reservation*, not a record: `sim_main.cpp` writes
`candidate + 3600` to the NVS key `mcclock` before the advert goes out, and
only writes again once an hour of advert clock has been consumed. So every
timestamp that reaches the air is strictly below the stored floor, and a power
cycle at any moment resumes above everything already transmitted. Persisting
*after* transmitting would have left exactly the gap this rule exists to close:
a write that fails after a send makes the deck replay a timestamp it has
already used, and every future advert from that key is then dropped in silence.
An advert whose reservation cannot be written is not sent.

**3. A caller — landed.** `transmit_meshcore_advert()` fills a
`MeshCoreAdvertAppData` with `node_type` `Chat`, the deck's own long name, and
`has_location` from `meshCoreDegreesToMicros()` on the GPS fix only when there
is a valid one and GPS is enabled. It is gated on
`activeProfile().protocol_hint == ProtocolId::MeshCore` rather than on the
operator remembering, because the frame under any other profile is a
well-formed MeshCore packet on a band where no MeshCore node is listening.
`MeshCoreAdvertReach::ZeroHop` is what both the automatic advert and the plain
serial command send, matching stock companion defaults; `Flood` is reachable
only through the explicit `LSK TX meshcore advert flood`, because a flooded
advert spends the whole mesh's airtime.

Pacing lives in `loop()` beside the Meshtastic beacons: an advert on arriving
at a MeshCore profile, then one every `kMeshCoreAdvertMs` (fifteen minutes).
A 107-byte advert at SF7/62.5 kHz takes **0.37 s** of airtime, and that
number is computed rather than asserted, because an earlier draft of this
document quoted 0.42 s in five places without showing its working.

    Tsym       = 2^SF / BW = 2^7 / 62500          = 2.048 ms
    payload    = 8 + ceil((8*107 - 4*7 + 28 + 16) / (4*7)) * 5
               = 8 + 32 * 5                        = 168 symbols
    preamble   = (8 + 4.25) * 2.048 ms             = 25.1 ms
    total      = 25.1 + 168 * 2.048                = 369 ms

With MeshCore's 16-symbol preamble instead it is 386 ms; either way the
figure below is the right order and the conclusion is unchanged. One advert
per fifteen minutes is 0.04 % duty
— fifteen times more sparing than the position beacon, and an advert is
discovery rather than telemetry, so a node that has heard us once keeps the
contact and repeating faster buys nothing. The same change stopped the
Meshtastic beacons firing under a MeshCore profile, where NodeInfo was noise
no listener could read.

**4. Politeness and honest capture — half landed.** Our own transmission is
ingested as a `FrameDirection::Transmit` frame through
`ingest_own_transmission()`, which the Meshtastic path now shares, so captures
stay truthful about what this deck put on the air. The pre-TX channel-activity
poll of §2 did **not** land: it needs an `isReceiving()`-shaped accessor on
`TDeckRadioService`, which does not exist, and the advert rate makes it cheap
to defer — but it stops being cheap the moment the interval shortens or DMs
arrive, so it belongs with stage 3 at the latest. The seen-packet marking for
our own floods belongs with the dedup table in stage 2, which is also where
inbound adverts start being processed at all.

**5. `kMeshCoreTransmitReady` is now true — and it changed meaning.** This plan
originally tied the flip to a stock MeshCore node listing the deck. That made
the flag unreadable once the wiring landed: its own comment said "nothing in
the firmware calls it yet", and leaving it false with a live transmit path
would have been a false statement in the code that everything else reads. It
now means what its name says — the firmware has an identity, a clock and a
caller — and the stock-node confirmation is tracked as the stage 1 milestone
instead, where a milestone belongs.

That milestone is still open. Byte-level agreement with two independent
implementations and a full round trip through `MeshCoreDecoder` are real
evidence, but they are evidence about bytes; nothing in this repository has yet
proved that the deck's radio settings put those bytes on the air in a form a
stock receiver demodulates.
