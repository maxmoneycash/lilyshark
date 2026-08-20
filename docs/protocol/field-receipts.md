# Field Receipts — a proof-of-capture protocol (v0 draft)

Lilyshark already produces evidence: a capture is bytes the radio heard,
committed to Shelby, anchored on-chain. Field Receipts is the layer that
makes producing that evidence *worth something* — a protocol for turning
verifiable field work (capturing, witnessing, surveying) into an on-chain
score that a community can rank, reward, and eventually redeem.

This is a v0 design document. The primitives are chosen so that everything
awarded on-chain is checkable on-chain, and everything that requires
off-chain judgment is computed by a published, reproducible script over
on-chain events — never by a trusted server with a private database.

## Why this exists

Mesh communities produce enormous public value — coverage, relays, tooling —
and capture almost none of it. Networks that did close that loop (Helium's
proof-of-coverage, Hivemapper's map mining, Flightradar24's feed-for-premium
trade) grew orders of magnitude faster than volunteer mapping ever did,
because they made the invisible work *legible*: measured, ranked, and
rewarded. Lilyshark is unusually well placed to do the same for LoRa mesh,
because the device's whole job is producing tamper-evident measurements.

The design constraint that separates this from the DePIN graveyard: **the
reward tracks evidence quality, not hardware presence.** Helium paid for
being there and got spoofed by simulated hotspots; we pay for receipts that
independent parties corroborate.

## The primitives

### 1. Capture receipt (exists today)

`lilyshark::capture_registry::register` anchors a capture: publisher,
32-byte Shelby blob commitment, blob name, size, lease expiry. Anyone can
fetch the blob and verify the bytes against the commitment. This is the
base unit of the protocol and it is already deployed to shelbynet.

### 2. Witness attestation (new)

Two devices that hear the same LoRa transmission hold captures whose *radio
metadata differs* (RSSI, SNR, frequency error are receiver-local) but whose
*frame payload bytes are identical*. That coincidence is the protocol's
anti-spoof primitive: it is cheap to fabricate a capture alone, and hard to
fabricate the same frame into two independently operated receivers.

A **witness key** identifies one over-the-air transmission:

```
witness_key = SHA-256(
    frame payload bytes ||
    center frequency, rounded to 25 kHz, uint32 LE Hz ||
    time bucket, uint32 LE = unix_seconds / 60
)
```

- Payload bytes are the frame as captured, after CRC — not the radio
  metadata, which legitimately differs per receiver.
- The 25 kHz rounding absorbs crystal offset between receivers; the 60 s
  bucket absorbs clock skew while keeping replayed old frames out. A frame
  straddling a bucket boundary may produce two candidate keys; devices
  submit the bucket of their own receive timestamp, and a missed match is
  an accepted loss (the schedule prices witnessing as a bonus, not a
  requirement).
- The key deliberately contains **no location and no node identity** — a
  witness proves "this transmission happened and ≥2 parties heard it",
  nothing about who sent it. Capture files remain where the full context
  lives.

`lilyshark::field_points::attest_witness(witness_key)` records the caller
against the key. When a second *distinct* account attests the same key
within the attestation window, both accounts are credited witness points —
enforced entirely on-chain. Later attesters of an already-corroborated key
are recorded (the corroboration count is itself useful data) but earn
decaying credit, so a popular beacon frame is not a money printer.

### 3. Coverage cells (off-chain scored, on-chain sourced)

A survey observation maps to a **cell**: geohash-5 (~5 km) × band × ISO
week. First verified capture anchored from a previously empty cell earns a
discovery bonus; repeat surveys of the same cell decay. Cell scoring needs
GPS context that lives inside capture files, not on-chain, so it is
computed by `scripts/field_receipts_score.py` (task PR-005) — a
deterministic script anyone can run against the public event log and the
public blobs. Publishing the scorer *is* the trust model: disputes are
settled by re-running it.

### 4. Points, seasons, and the token question

Points (`field_points::Points`) are **non-transferable** and live under
each account. Non-transferable is a deliberate legal and mechanical choice:
points are a scoreboard, not an instrument. They cannot be sold, so they do
not attract speculators before the network produces anything worth
speculating on — the failure that killed most 2021-era DePIN launches.

Scoring runs in **seasons** (calendar quarters). Each season's rules —
point weights, decay curves, cell bonuses — are published before the season
starts and frozen for its duration.

**The Shelby token path.** Shelby's serving economy (metered reads,
compensated gateways) is the economic engine this design bets on, and
Shelby has not published a token or pricing schedule yet (see
[why-shelby.md](../why-shelby.md)). The honest sequencing:

1. **Now — points and rank.** Leaderboards, badges, and profile pages on
   lilyshark.com read the on-chain events. Rewards are non-monetary:
   recognition, early-access firmware, premium analyzer features.
2. **When Shelby's economy is live** — season points become the
   distribution key for whatever value the project actually captures:
   revenue share from the data products (below), sponsored reward pools,
   or conversion into Shelby-native compensation if their gateway economy
   admits third-party pools.
3. **A Lilyshark-issued token is explicitly out of scope for v0.**
   Issuing a token against future rewards is a securities decision, not an
   engineering one, and nothing in this design requires it. Every
   primitive here works if a token never exists; everything is *ready* if
   one does, because the score is already on-chain and sybil-priced.

### What the points buy even without a token

The redemption loop that works today, patterned on Flightradar24's
feed-for-premium trade:

- **Rank** — season leaderboards and per-cell "first surveyed by" credit
  on the coverage map.
- **Access** — premium analyzer features free for active contributors.
- **Hardware** — discounts on pre-flashed T-Decks funded from hardware
  margin.
- **Data dividends** — if aggregated coverage/spectrum data is ever sold
  (API access for site surveys, interference studies), season points are
  the published revenue-share key.

## Threat model, honestly

| Attack | Cost to attacker | Mitigation |
| --- | --- | --- |
| Fabricated capture, one account | Trivial — bytes are free | Solo captures earn the minimum; all real weight is on corroborated witnesses and first-in-cell discoveries |
| Self-witnessing with two accounts + one transmitter | Two funded accounts, real RF hardware, real airtime | Sybil pairs that only ever witness each other are visible in the public event graph; the season scorer down-weights closed witness cliques. Not eliminated — priced. |
| GPS spoofing for cell bonuses | Low (software) | Cell bonuses require the anchored capture blob (RF environment must be plausible for the claimed cell); scorer cross-checks against other receipts from the same cell. Weakest point of v0 — flagged, not solved. |
| Replay of heard frames to farm witnesses | Real transmissions (airtime, license exposure) | Time bucket in the witness key caps replay value at one credit per minute per frame; decay on already-corroborated keys caps it further. Replaying also *is* transmitting: it produces real coverage data. |
| Registry spam to farm anchor points | Shelby storage fees per blob + gas per anchor | Anchor points require the blob to exist and resolve at scoring time; spam pays Shelby for storage of junk that earns the minimum. |

v0 does not claim sybil-*proofness* — it claims that every farming path
either costs real money (storage, gas, hardware, airtime) or is visible in
public data that the published scorer penalizes. Stake-weighting and
hardware attestation are v1 questions, and only worth answering if v0
shows real usage.

## Wire and chain surfaces

- **On-chain (Move, shelbynet / Aptos):** `capture_registry` (deployed) and
  `field_points` ([contracts/field-points/](../../contracts/field-points/)):
  witness book, per-account points, anchor-claim against registry count,
  season events.
- **Over the air:** nothing new. The 82-byte `SHLB` pointer is unchanged;
  witnessing uses frames the mesh already carries. A protocol that demanded
  new airtime would be spending the resource the whole design economizes
  (R = 7.36 transmissions per delivered flood message — the whitepaper's
  central measurement).
- **Device:** the firmware computes witness keys for frames it captures
  (payload hash it already has; frequency and timestamp it already
  records) and queues them in the capture sidecar; attestation happens
  when the operator's phone or the analyzer next has connectivity, exactly
  like pointer resolution. No keys on the device — same rule as uploads.
- **Analyzer:** lilyshark.com submits attestations from an opened capture,
  renders leaderboards/cells from chain events, and shows each frame's
  corroboration state inline in TRAFFIC.

## Sequencing

1. `field_points` module with witness book and anchor claims, unit-tested
   (CO-001..003).
2. Witness-key computation in `scripts/` + `webapp` from existing `.lscap`
   files, golden-vectored across implementations like the pointer
   (PR-002..004).
3. Analyzer: attest from capture, corroboration badge in TRAFFIC,
   leaderboard panel reading events (UI tasks).
4. Season 0 scorer + published rules (PR-005..006); firmware witness
   sidecar last (FW), since the analyzer path exercises the whole loop
   without touching the device.

Every step is independently useful: witness keys alone are a dedup/
correlation feature for multi-device captures even if nobody ever scores a
point.
