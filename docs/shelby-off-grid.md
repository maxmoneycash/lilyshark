# Shelby off-grid: blobs over a 200-byte pipe

This is the design that ties the two halves of Lilyshark together, and the
reason the project exists on Shelby at all.

## The constraint, measured

A LoRa mesh moves ~200 usable bytes per frame. That is far too small for
media — and far larger than a blob reference.

This is not a style preference; it is measured. Against Meshtastic's own
discrete-event simulator, a flooded mesh spends **R = 7.36 transmissions per
delivered message** at realistic density (the literature assumed 3–5), and
delivery reach falls from 68.6% to 25.8% as nodes are added, because every
relay consumes shared channel time. Airtime is the scarce resource. Pushing
payloads through the pipe is how you get the two oldest complaints about
mesh radio — no photos, and messages that die when you are offline.

The design rule follows directly: **send a reference, let a connected node
carry the bytes.** The scaling math behind that rule — pointer capacity at
each architecture step, capture accumulation on Shelby, and the
reference-vs-payload airtime gap — is modeled with tested invariants in
`analysis/` (`analysis/results.md`).

## The pointer

`docs/shelby-pointer-format.md` specifies the 82-byte record (magic `SHLB`):
blob commitment, owner account, size, expiry, and chunk position. Two
properties make it work in the real mesh:

- **It is an application payload convention, not a link layer.** It rides
  inside Meshtastic, MeshCore, or Reticulum payloads behind their own
  headers, so one encoding serves all three networks and a node running
  stock firmware relays it untouched.
- **Decoding rejects inconsistent chunk state.** A receiver can never
  mistake one part of a split blob for a complete one.

The firmware encodes and detects it; the web app and the Python tooling read
the identical bytes. All three implementations are pinned to the same golden
test vector.

## The lifecycle

```
off-grid node                mesh                gateway (connected)              Shelby
     │                        │                       │                              │
     │  SHLB pointer (82 B)   │                       │                              │
     │───────────────────────▶│── relay, untouched ──▶│                              │
     │                        │                       │  resolve: fetch blob by      │
     │                        │                       │  owner + name, then VERIFY   │
     │                        │                       │  commitment + size + expiry ─▶│
     │                        │                       │                              │
     │                        │                       │  serve / re-upload / analyze │
```

1. **Emit.** A node (or the gateway itself, for content it holds) announces a
   blob with `scripts/shelby_pointer.py emit`. The commitment is SHA-256 of
   the bytes, so any holder of the blob can prove it is what the pointer
   claims. Large blobs are announced as a set of chunk pointers.
2. **Carry.** The pointer travels the mesh inside whatever protocol is
   already running. Lilyshark firmware records it like any other frame.
3. **Detect.** The firmware's pointer decoder surfaces it (registered after
   the protocol decoders), and `shelby_pointer.py scan` finds it in any
   `.lscap` capture — the demo capture in `samples/` carries one at
   sequence 9.
4. **Resolve and verify.** A connected node fetches the blob and checks it
   against the pointer before trusting it: `shelby_pointer.py verify`.
   Bytes that fail verification are discarded, never served.
5. **Use.** Captures themselves are blobs: the web analyzer opens a `.lscap`
   straight from Shelby by blob name.

## Recipes

Announce a capture you will upload to Shelby, chunked at 800 bytes:

```sh
python3 scripts/shelby_pointer.py emit field.lscap \
  --owner 0x<32-byte account> --capture --days 60 --chunk-size 800
```

Find every pointer heard during a field session:

```sh
python3 scripts/shelby_pointer.py scan captures/field-day.lscap
```

Verify a blob you resolved before serving it onward:

```sh
python3 scripts/shelby_pointer.py verify blob.shlb downloaded-bytes.bin
```

## Security properties

- **The firmware never holds channel keys.** The `encrypted` flag is a claim
  it reports, nothing more; decryption happens where the key lives.
- **Verification is mandatory, not optional.** A pointer is a claim about
  remote bytes; `verify` enforces the commitment, the size, and the expiry
  before those bytes are used.
- **Chunk consistency is structural.** `chunked` ⇔ `chunk count > 1` is
  enforced by every implementation, so partial content cannot pass as whole.

## Status

Built and tested: the pointer codec (C++/TypeScript/Python, cross-checked
byte for byte), the cross-protocol decoder, the capture format, the
analyzer, and the local half of the gateway (emit/scan/verify).

Next, not yet shipped: the always-on gateway service that watches for
pointers and resolves them against Shelby over IP unattended. The pieces it
will be assembled from — fetch by blob name, verification, upload — each
exist and are exercised above.
