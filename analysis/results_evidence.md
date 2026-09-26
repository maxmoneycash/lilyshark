# Shelby prototype indexer snapshot

Snapshot: 2026-08-15T21:37:25Z (Early Access testnet, via the indexer that
backed lilyshark.vercel.app). Regenerate with
`python3 analysis/shelby_network_evidence.py --offline` for the pinned
fixture. These are historical indexer counters, not current network
metrics or independently audited storage and payment records.

> Shelby's [current network documentation](https://docs.shelby.xyz/protocol/architecture/networks)
> describes a developer prototype that can be reset. Transaction and
> activity counts below do not establish durable retrieval, user demand,
> a production economy, or Lilyshark gateway compensation.

## What the indexer reported at the snapshot time

| Measure | Value |
| --- | ---: |
| Blobs stored | 393,000 |
| Data stored | 108.20 GB |
| Unique blob owners | 48,272 |
| Indexer activity records | 3,529,910 |
| Activities per blob | 9.0 |
| ShelbyUSD transactions (all time) | 8,087,316 |
| ShelbyUSD volume (all time) | 251,541 |
| Transfers in the last 24 h | 26,851 |
| ShelbyUSD volume (24 h) | 647.68 |
| Average transaction | 0.031 ShelbyUSD |

These counters describe activity in one prototype environment at one
date. They do not establish who paid whom or whether old blobs still resolve.

## The snapshot's average object was capture-sized

The average blob in this snapshot was **275 KB**. A Lilyshark
field-session capture is ~200 KB; the demo capture in this
repo is 4.7 KB. Captures are not an unusual
object for that recorded workload:

| Content type | Blobs | GB stored | Share | Avg size |
| --- | ---: | ---: | ---: | ---: |
| image | 129,751 | 33.21 | 33.0% | 256 KB |
| other | 66,805 | 17.39 | 17.0% | 260 KB |
| text | 65,618 | 16.63 | 16.7% | 254 KB |
| document | 65,510 | 16.66 | 16.7% | 254 KB |
| json | 65,305 | 24.30 | 16.6% | 372 KB |
| archive | 11 | 0.00 | 0.0% | 38 KB |

The indexer counted ~9 activity records per blob.
That count alone does not show distinct readers, useful retrievals, or
compensation to serving gateways.

![Average blob size by content type vs a capture](chart_blob_sizes.svg)

## What this does and does not support

- The prototype indexer reported objects of roughly capture size.
  Size compatibility is useful for a design test, not a storage SLA.
- The 82-byte pointer can name a content-committed blob. Test current
  resolution and retention before relying on it for field evidence.
- The `blob_activities` indexer (3,529,910 records) is
  a possible input to a future serving audit; it is not proof that
  Lilyshark gateways were paid.
