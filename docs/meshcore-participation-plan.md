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
3. **Ed25519 + key exchange** (~70 KB flash, measured). **Vendor
   `lib/ed25519` from the MeshCore repo** (orlp/ed25519, zlib license, 17
   files) as `src/crypto/ed25519/`. Rationale: it is the exact code stock
   nodes run, so key expansion (64-byte expanded private key), signing,
   verification, and the Edwards→Montgomery exchange match by construction;
   it is plain C99 that compiles for both the simulator and the ESP32-S3
   (verified: builds with the pinned Xtensa GCC at -Os, 69,946 bytes text
   total, zero static RAM); and it is the smallest audited option that
   provides all four operations. Keep `license.txt`, add attribution to
   `NOTICE.md`, drop `add_scalar.c`/`seed.c` (unused).
   - **X25519 overlap**: the parallel Meshtastic-PKC work needs raw X25519.
     orlp's `fe.c` field arithmetic plus the ladder in `key_exchange.c` are
     exactly that, minus the Edwards unpack step. The PKC branch should add
     an `x25519(out, scalar, u_bytes)` entry point over the same `fe.c`
     rather than vendoring a second curve library — the marginal flash cost
     is a few hundred bytes because `fe.o`/`ge.o` are already linked.
4. **Epoch clock** (small but load-bearing). Frames carry epoch seconds and
   peers enforce per-identity monotonicity. The firmware currently keeps
   only monotonic microseconds. Sources in priority order: GPS UTC (already
   parsing NMEA via TinyGPSPlus), user/webapp-set time over the serial link,
   and a persisted floor. Persist the last timestamp we transmitted and
   always send `max(now, last + 1)` (MeshCore's `getCurrentTimeUnique` does
   the same) so a cold deck with no fix cannot brick its own advert stream.
5. **MeshCore node state**: identity (96 B) in NVS; contact table (pub key,
   cached shared secret, out-path, name, last-advert timestamp ≈ 176 B per
   contact, 32 contacts ≈ 5.6 KB); seen-packet ring (~2 KB); outstanding-ack
   list; a small delayed-TX queue (MeshCore staggers replies: ACKs +200 ms,
   flood retransmit jitter — we need the delay slots, not the priorities).
6. **`meshcore_encode.{h,cpp}`**: replace today's stub (which returns 0 and
   documents this exact plan as its future) with real builders mirroring
   `meshtastic_encode`'s shape: pure functions, fixed buffers, no
   allocation, host-testable.

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
| ed25519 (measured, -Os Xtensa: fe 11.0K, ge 34.6K, sc 17.9K, sha512 5.0K, ops 1.2K) | ~70 KB | 0 |
| SHA-256 + HMAC | ~3 KB | 0 |
| AES inverse cipher | ~1.5 KB | ~0 |
| encoders + node state machine + UI glue | ~8 KB | — |
| contacts (32×176 B) + seen ring + queues + identity | — | ~10 KB |
| **Total** | **~83 KB (+1.3 % of slot)** | **~10 KB (+3.0 %)** |

Flash lands at ≤ 69.3 % (≤ 77.1 % even on a full-tile build) — comfortable.
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
- **Deterministic signature stack/latency on the S3.** ~70 KB of curve code
  is fine for flash but sign/verify are tens of milliseconds at 240 MHz;
  doing verify inline for a burst of adverts could stutter the UI loop.
  Mitigation: verify at most one advert per loop tick from a small queue.
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
