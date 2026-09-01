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

## The draft

> **A packet analyzer that decodes Reticulum announces**
>
> I've been building Lilyshark, a handheld LoRa analyzer for the LILYGO
> T-Deck — Wireshark-style capture with the radio measurements kept
> alongside the bytes. It already decoded Meshtastic and MeshCore
> structurally; it now decodes RNS announces too, on the device and in
> the browser analyzer.
>
> What it reads from an announce: destination hash, hop count, the
> presence and byte ranges of the public key, name hash, random hash,
> ratchet and signature, and `app_data` as raw bytes. It rolls a capture
> up per destination — announce count, first and last seen, cadence, hop
> range, path changes — so you can see how a destination is announcing
> over time.
>
> What it does not do: it does not validate signatures, does not derive
> identities, and does not decrypt anything. The 10-byte name hash is
> shown as a hash, because it is not invertible — I'd rather show you a
> hash than invent a name. `app_data` is application-defined and usually
> msgpack, so it stays raw bytes with a printable-ASCII preview only when
> every byte is printable, and it's labelled as a preview.
>
> Split frames, IFAC-protected frames, and non-SINGLE destinations stay
> structurally decoded — the announce tier only engages when the length
> arithmetic proves the fixed fields are there.
>
> The decoders are golden-vectored: the same fixture bytes pin the C++
> firmware decoder and the TypeScript one in the browser, so they cannot
> drift.
>
> Repo (GPL-3.0): https://github.com/maxmoneycash/lilyshark
> Analyzer, no radio needed: https://lilyshark.com
>
> I'm not an RNS expert and the framing came from reading the spec and
> the stack, not from being told. If I've got something wrong — especially
> around header type 2 addressing or the ratchet context flag — I'd
> rather hear it now.

## Handling the response

- **Corrections are the point.** Anything factual gets verified against
  the reference stack and turned into a fixture plus a task on the
  board, not a defensive reply.
- **Feature asks** go on the board with the asker's use case recorded
  verbatim. Path/link-state visualization and per-interface airtime are
  the two most likely, and both are genuinely useful.
- **"Why not just use rnstatus?"** is a fair question with a real answer:
  those probe a node you run. This reads the air, from a receiver that is
  not part of the network, which is the view nobody currently has.
- **Hostility to the on-chain parts** is plausible in this community.
  The honest answer: the analyzer never needs a chain, the Field Receipts
  layer is opt-in, there is no token, and the storage integration is one
  screen you can ignore entirely. Do not argue past that.

## Before posting

- [ ] Capture real RNS announce traffic and screenshot the actual panel —
      do not post synthetic data (the app labels it `SYNTHETIC · NOT OTA`
      for exactly this reason, and posting it would read as a lie)
- [ ] Verify the framing claims against the reference stack one more time
- [ ] Check the live site works for a first-time visitor with no radio
- [ ] Be available for the first day; an unanswered correction thread is
      worse than not posting
