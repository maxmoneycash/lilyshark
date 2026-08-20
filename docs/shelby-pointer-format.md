# Shelby off-grid pointer format (`SHLB`)

The Shelby pointer is an 82-byte record that lets a LoRa mesh refer to a
Shelby blob it could never carry. A LoRa frame moves ~200 usable bytes of
application payload — far too small for media, and far larger than a blob
reference — so the radio carries the reference and a node with connectivity
(a gateway, or the operator's phone when it next has signal) resolves the
pointer and moves the bytes.

Keeping the over-the-air object this small is a measured design rule, not a
style choice. Against Meshtastic's own discrete-event simulator, a flooded
mesh spends R = 7.36 transmissions per delivered message at realistic
density, and delivery reach falls from 68.6% to 25.8% as nodes are added,
because every relay consumes shared channel time. Airtime is the scarce
resource; the pointer is the smallest object that preserves the reference.
The scaling model built on these measurements is
[`analysis/results.md`](../analysis/results.md).

## Carriage

The pointer is an **application payload convention, not a link layer**. It
rides inside the payload of whatever protocol already carries the frame —
Meshtastic, MeshCore, or Reticulum — behind that protocol's own header. One
encoding therefore serves all three networks, and a node running stock
firmware relays it untouched, because forwarding does not require
understanding the payload.

Receivers locate a pointer by scanning the payload for the magic and then
validating every field (`findShelbyPointer`), so the enclosing protocol's
header length does not matter. Decoders must not assume offset 0.

## Encoding rules

- Total size: exactly 82 bytes
- Byte order: little-endian for every multi-byte integer
- Version: `1`; readers must reject any other version
- Readers must reject structurally impossible field combinations (see
  [Chunking](#chunking)) rather than guess

## Layout

| Offset | Size | Field | Encoding |
| ---: | ---: | --- | --- |
| 0 | 4 | magic | ASCII `SHLB` |
| 4 | 1 | version | `1` |
| 5 | 1 | flags | bit field, see below |
| 6 | 32 | blob commitment | 32 raw bytes |
| 38 | 32 | owner account address | 32 raw bytes |
| 70 | 4 | blob size in bytes | uint32 |
| 74 | 4 | expiry | uint32 unix seconds |
| 78 | 2 | chunk index | uint16, `0` when not split |
| 80 | 2 | chunk count | uint16, `1` when not split |

### Flags

| Bit | Name | Meaning |
| ---: | --- | --- |
| 0 | `encrypted` | The referenced blob is encrypted with the channel key. A relay never holds that key; it only reports the claim. |
| 1 | `chunked` | The blob is one part of a multi-frame set. Must agree with `chunk count`; see below. |
| 2 | `capture` | The pointer describes a Lilyshark `.lscap` capture rather than user content. |

Undefined flag bits are reserved. Writers must clear them; readers must
ignore them.

### Commitment and owner

`blob commitment` is a 32-byte content identifier for the blob. The
reference tooling in `scripts/shelby_pointer.py` uses SHA-256 of the blob
bytes, so any holder of the bytes can verify them against the pointer
without trusting the source. `owner account address` is the 32-byte Shelby
account that uploaded the blob; together with the blob name (known to the
uploading gateway, and deliberately not carried over the air) it identifies
the blob for retrieval.

## Chunking

A blob larger than one frame's worth of resolution work can be announced as
a set of chunk pointers that share the same commitment, owner, size, and
expiry, and differ only in `chunk index`.

- `chunk count` must be at least `1`.
- `chunk index` must be less than `chunk count`.
- The `chunked` flag must be set if and only if `chunk count` is greater
  than `1`.

The last rule is a safety property, not a stylistic one: a receiver that
accepted `chunk count > 1` without the flag — or the reverse — could mistake
one part of a split blob for a complete one. Every implementation in this
repository rejects both inconsistencies, and a receiver must treat the
pointer as malformed rather than attempt repair.

## Test vector

The following 82 bytes (hex) are the byte-exact output of the C++ encoder
for the field values below. Every implementation in this repository is
tested against this vector, so the C++ encoder, the TypeScript webapp
reader, and the Python tooling accept and produce identical bytes.

```
53484c420105a0a1a2a3a4a5a6a7a8a9aaabacadaeaf
b0b1b2b3b4b5b6b7b8b9babbbcbdbebf0104070a0d10
1316191c1f2225282b2e3134373a3d404346494c4f52
55585b5e0000100080d8db7000000100
```

| Field | Value |
| --- | --- |
| flags | `0x05` (`encrypted` + `capture`) |
| commitment | bytes `A0`–`BF` in order |
| owner | byte `i` = `(3i + 1) mod 256` for `i` in 0–31 |
| size | `1048576` (1 MiB) |
| expiry | `1893456000` (2030-01-01T00:00:00Z) |
| chunk index / count | `0` / `1` |

## Implementations

| Component | Language | Role |
| --- | --- | --- |
| `src/shelby/shelby_pointer.cpp` | C++17 | Firmware encoder/decoder and payload scanner; runs on the T-Deck |
| `src/shelby/shelby_pointer_decoder.cpp` | C++17 | Capture-engine decoder that surfaces pointers inside any protocol's frames |
| `webapp/src/lib/lscap.ts` | TypeScript | Browser reader; decodes pointers found in `.lscap` captures |
| `scripts/shelby_pointer.py` | Python 3 | Reference tooling: emit, parse, scan captures, and verify blobs against pointers |

## Sample data

`samples/sample-mesh-traffic.lscap` (generated deterministically by
`scripts/generate_sample_capture.py`) is a synthetic `.lscap` 1.1 fixture. All
records carry the synthetic provenance flag. It carries a pointer at sequence 9,
behind a 16-byte protocol header. The web analyzer's Traffic tab marks the
frame `SHLB` and decodes the pointer inline, and
`python3 scripts/shelby_pointer.py scan samples/sample-mesh-traffic.lscap`
finds it from the command line.
