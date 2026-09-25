# Telling Reticulum that its analyzer exists

Task GR-007. First-mover credit in a gap only counts if the people who
named the gap see the thing working. The FOSDEM 2026 community meetup
listed thin observability among Reticulum's open problems; as of this
writing a search for a Reticulum dissector or GUI analyzer turns up
nothing but the stack's own CLI probes (`rnstatus`, `rnpath`, `rnprobe`)
and one hobby packet listener. Lilyshark now decodes announces on the
device and in the browser, and rolls them up per destination.

## Register

The Reticulum community is post-corporate by choice and allergic to
launch-speak. Write like someone showing a tool at a meetup, not like a
project doing outreach:

- Lead with the capture, not the project. A screenshot of the ANNOUNCES
  panel over real traffic says more than any paragraph.
- Say what it does **not** do, early. It reads announces and link-layer
  structure; it does not decrypt anything, and it never will without
  keys the operator supplies.
- No roadmap promises, no "we're excited to", no logo. Link the repo and
  the live analyzer, and stop.
- The project is GPL-3.0 and the protocol work is public. Say so once —
  in a community reorganizing around forks after a licensing dispute,
  that is the load-bearing fact.

## Where

| Venue | Notes |
| --- | --- |
| The community Zulip (successor to the Matrix room) | Primary. Technical, threaded, where the post-Carrier-Switch reorganization happened. |
| r/reticulum | Secondary; screenshot-friendly. |
| Hackaday tip line | They covered Reticulum in July 2026 and MeshCore before that; a working analyzer for a stack that has none is exactly their beat. |
| FOSDEM / the community meetup | The venue that *named* the gap. A lightning talk with a live capture is the highest-value version of this. |

Post to one venue first, absorb the corrections, then the rest. A wrong
claim about RNS framing, repeated across four venues on the same day, is
harder to walk back than to prevent.

## Venue-specific drafts

### 1. The community Zulip (`#development` / topic: `Handheld packet analyzer and dissector for Reticulum announces over LoRa`)

> **Handheld packet analyzer and dissector for Reticulum announces over LoRa**
>
> I've added Reticulum announce dissection to Lilyshark, an open-source handheld LoRa packet analyzer for the LILYGO T-Deck and browser. It passively captures over-the-air frames and dissects the RNode encapsulation and RNS announce tier.
>
> **Wire dissection breakdown (captured frame, 172 bytes, Header 1 announce):**
>
> ```
> [00] RNode physical framing: 0x00 (complete unfragmented frame)
> [01] RNS header flags: 0x01
>      - IFAC: 0 (clear, unmasked)
>      - Header Type: 1 (19-byte clear header, no transport ID)
>      - Context Flag: 0 (no ratchet field)
>      - Propagation: 0 (broadcast)
>      - Destination Type: SINGLE (0x00)
>      - Packet Type: ANNOUNCE (0x01)
> [02] Hops: 1
> [03..18] Destination Hash (16B): 3a8f2e9b14c7d0e52a91b48cf0e719aa
> [19] Context: 0x00
> Payload (152B):
>   [20..83]   Public Key (64B): X25519 (32B) + Ed25519 (32B)
>   [84..93]   Name Hash (10B): 9f4a12c85b73e1648a02
>   [94..103]  Random Hash (10B): 7b21e04dc891aa3560fe
>   [104..167] Signature (64B): Ed25519 announce signature
>   [168..171] App Data (4B): 0x74 0x65 0x73 0x74 ("test" printable ASCII preview)
> ```
>
> **What it reads from an announce:**
> - Destination hash, hop count, and the exact byte ranges of the public key, name hash, random hash, optional ratchet (when the context flag is set), and signature.
> - `app_data` is preserved as raw bytes. When 100% of bytes are printable ASCII, a preview is rendered; otherwise raw hex.
> - Rolls a capture up per destination in the ANNOUNCES tab: announce count, first and last seen timestamps, inter-arrival cadence, hop range, and path transitions (e.g. direct hop-0 vs relayed hop-1+).
> - Airtime accounting: tracks SX1262 on-air duration per transmission, separating Reticulum duty cycle from background traffic or Meshtastic.
>
> **What it does NOT do (boundary honesty):**
> - It does not validate Ed25519 signatures, derive private identities, or decrypt payloads. Signature and key fields are reported by presence and offset arithmetic only.
> - The 10-byte name hash is displayed strictly as hex — because it is a non-invertible hash, it is never guessed or spoofed.
> - It does not invent intermediate nodes: RNS HEADER_1 names no relay, and HEADER_2 names at most one transport instance. The analyzer explicitly states this constraint.
>
> Split frames, IFAC-protected frames, and non-SINGLE destinations remain structurally decoded. The C++ firmware decoder and TypeScript web decoder share identical wire fixture vectors.
>
> Repo (GPL-3.0): https://github.com/maxmoneycash/lilyshark  
> Live analyzer (works on sample captures with no radio or install): https://lilyshark.com  
>
> Three questions for RNS devs:
> 1. In HEADER_2 frames, is the 16-byte transport instance preceding the destination hash consistently treated as the hop-origin transport ID across all RNS interfaces?
> 2. For ratchet payloads under context flag `0x20`, are there any deployments placing the 32 bytes anywhere other than immediately before the signature?
> 3. For `app_data`, would an optional structural MessagePack inspector (e.g. for LXMF/Sideband announces) be welcome, or is strict raw byte inspection preferred?

---

### 2. Reddit (`r/reticulum`)

> **[Tool] Lilyshark: Handheld & web-based LoRa packet analyzer with Reticulum announce dissection**
>
> I've been building Lilyshark, an open-source (GPL-3.0) pocket LoRa packet analyzer running on the ESP32-S3 LILYGO T-Deck and modern web browsers. It now decodes over-the-air Reticulum Network Stack (RNS) announces alongside RNode link framing.
>
> **Why?**
> Reticulum CLI probes (`rnstatus`, `rnpath`, `rnprobe`) are built to ask a running node what its own routing table knows. But when tuning LoRa antennas, measuring RF floor noise, debugging announce flood cadence, or finding why two nodes fail to establish links in the field, you need a passive instrument that listens to the raw air without joining the mesh or needing daemon configuration.
>
> **What the analyzer provides:**
> - **TRAFFIC tab:** Wireshark-style dissection tree. Breaks out RNode framing, header flags (IFAC bit, header type 1/2, context flag, destination type, packet type), hop counter, destination hash, cryptographic field spans (public key, name hash, random hash, ratchet, signature), and raw application data.
> - **ANNOUNCES tab:** Dedicated destination dashboard. Groups announces by 16-byte destination hash, computing announce cadence, hop range, time first/last seen, and highlighting when a node changes paths or transport instances.
> - **IO GRAPH:** Visualizes packet rates and SX1262 LoRa physical airtime consumption (duty cycle %) by protocol over time.
> - **LoRa metadata:** Preserves RSSI, SNR, frequency error, bandwidth, spreading factor, and precise microsecond timestamps.
> - **Export:** Exports sessions to LoRaTap PCAP for Wireshark, CSV, or JSON.
>
> **Strict instrument register:**
> No fake decryption, no signature claims without operator keys, no spoofed node names (10-byte name hashes stay hashes), and clear labeling of physical path limits.
>
> - GitHub repo (GPL-3.0): https://github.com/maxmoneycash/lilyshark
> - Browser analyzer (drag-and-drop a `.pcap` / `.lscap` or explore the bundled demo capture without hardware): https://lilyshark.com

---

### 3. Hackaday Tip Line

> **Subject:** Project Tip: Open-source handheld LoRa analyzer gains Reticulum mesh protocol dissection
>
> **Tip text:**
> Lilyshark, an open-source (GPL-3.0) handheld LoRa packet analyzer designed for the ESP32-S3 LILYGO T-Deck, has added passive over-the-air protocol dissection for the Reticulum Network Stack (RNS).
>
> Hackaday covered Reticulum earlier as an encrypted, decentralized alternative to TCP/IP and Meshtastic. However, Reticulum has historically lacked independent RF-level packet sniffers — operators relied entirely on CLI status commands queried from participating nodes.
>
> Lilyshark brings passive promiscuous listening to Reticulum over LoRa (433/868/915 MHz). Running on either standalone T-Deck hardware or directly in the browser via Web Serial / Web Bluetooth, it captures packets with precise SX1262 radio measurements (airtime, RSSI, SNR) and provides structural dissection of RNode encapsulation and RNS announce payloads (separating public keys, name hashes, ratchets, signatures, and app data).
>
> The project maintains parity between a native C++ embedded engine and a TypeScript web analyzer using identical golden test vectors. Sessions export directly to standard LoRaTap PCAP files for Wireshark.
>
> Project repository: https://github.com/maxmoneycash/lilyshark  
> Live web analyzer: https://lilyshark.com  
> Reticulum announcement write-up: https://github.com/maxmoneycash/lilyshark/blob/main/docs/strategy/reticulum-announcement.md

---

## Routing feedback back into the development roadmap

Any technical feedback, corrections, or feature requests from these venues are triaged directly into the project roadmap:

1. **`UI-019` (Dissect MessagePack in Reticulum announce `app_data`):**
   - *Trigger:* Community asks for human-readable display of common app payloads (NomadNet, LXMF, Sideband announce dicts).
   - *Requirement:* Bounded structural MessagePack reader that safely decodes non-encrypted dictionary keys while leaving unknown or binary payloads as raw bytes.
2. **`FW-011` (Reticulum IFAC packet handling and filter flags):**
   - *Trigger:* Questions regarding IFAC-protected broadcast or unicast frames.
   - *Requirement:* Explicit UI badge and filter expression (`rns.ifac == 1`) for IFAC-masked frames, clearly conveying why inner headers cannot be read without interface access keys.
3. **`UI-020` (Reticulum announce path-change graph visualization):**
   - *Trigger:* Requests to visualize topology shifts across multiple announces.
   - *Requirement:* Directed node-to-transport transition diagram derived from destination announce histories over time.
4. **`FW-012` (Reticulum regional channel presets and airtime profiles):**
   - *Trigger:* Clarifications on standard regional channel plans (EU 868 MHz 125 kHz SF9, US 915 MHz 500 kHz SF7).
   - *Requirement:* Built-in profile presets in firmware and webapp matching standard Reticulum interface configurations.

### Handling common community responses

- **"Why not just use rnstatus?"**
  `rnstatus` and `rnpath` probe a node you run. Lilyshark reads the air passively from a receiver that is not part of the network, showing RF duty cycle, collisions, and packet arrivals across all nearby nodes — the view a single node cannot see.
- **Hostility to on-chain components (Field Receipts / Shelby):**
  Lilyshark is a standalone local instrument. It has no mandatory server, no tokens, and zero blockchain requirements. The Field Receipts and decentralized storage screens are strictly opt-in extensions that can be completely ignored.
- **Corrections on framing:**
  Any factual correction is verified against the reference Python implementation (`Reticulum/RNS`), written into a new golden test fixture in `test/reticulum_announce/`, and deployed to both C++ and TypeScript decoders.

## Before posting

- [ ] Capture real RNS announce traffic over-the-air and verify against the ANNOUNCES panel.
- [ ] Confirm `https://lilyshark.com` loads the Reticulum demo capture cleanly in incognito mode.
- [ ] Verify test suite passes (`./scripts/test_all.sh`).
- [ ] Monitor community Zulip and r/reticulum threads promptly for technical corrections.
