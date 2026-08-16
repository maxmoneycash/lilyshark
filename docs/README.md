# Lilyshark documentation

## Start here

| Document | What it is |
| --- | --- |
| [quickstart.md](quickstart.md) | Evaluate the project in ten minutes — no radio required |
| [architecture.md](architecture.md) | The whole system on one page: firmware, tooling, web app, wire formats |
| [shelby-off-grid.md](shelby-off-grid.md) | The off-grid design: blobs over a 200-byte pipe, end to end |
| [why-shelby.md](why-shelby.md) | Why Shelby and not the SD card, S3, IPFS, or Arweave — the honest matrix |

## Specifications

| Document | Format |
| --- | --- |
| [shelby-pointer-format.md](shelby-pointer-format.md) | `SHLB` — the 82-byte Shelby off-grid pointer |
| [lilyshark-capture-format.md](lilyshark-capture-format.md) | `.lscap` — the native capture format |

Both are cross-language wire formats pinned by golden test vectors; every
implementation (C++, TypeScript, Python) accepts exactly the same bytes.

## Analysis

`analysis/` (repository root) — the quantitative case: a scaling model
(pointer capacity, capture storage, the reference-vs-payload asymmetry),
counterfactual failure models (card survival, gateway resolution), and
**measured evidence from the live Shelby network**. See `analysis/README.md`,
`analysis/results.md`, `analysis/results_counterfactuals.md`, and
`analysis/results_evidence.md`.

## Operating

| Document | Task |
| --- | --- |
| [FLASHING.md](FLASHING.md) | Flash a T-Deck with the release or a local build |
| [RECORDING_UI.md](RECORDING_UI.md) | Record the simulator UI for demos and screenshots |

## Sample data

`samples/sample-mesh-traffic.lscap` (repository root) — a deterministic
synthetic 24-frame capture carrying a Shelby pointer at sequence 9. See
`samples/README.md`.
