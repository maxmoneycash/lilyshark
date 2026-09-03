# Why Shelby — and why not the obvious alternatives

The question a reviewer should ask: captures are just files — why not the SD
card, an S3 bucket, IPFS, or Arweave? This is the honest answer, requirement
by requirement. The workflow has two halves that constrain the choice:

- A **capture** is evidence. It is worth something only if you can prove it
  is the same bytes the radio heard — immutable once written, retrievable
  years later, and verifiable on every read.
- A **pointer** is a reference that must resolve from anywhere, by anyone,
  asynchronously — including by a node that was off-grid when it heard it.

## The matrix

| Requirement | microSD | S3 / cloud bucket | IPFS + pinning | Arweave | **Shelby** |
| --- | --- | --- | --- | --- | --- |
| Immutable, tamper-evident on read | ✗ editable, unverifiable | ✗ mutable by the account holder | ✓ content-addressed | ✓ permanent | ✓ content-addressed |
| Survives years without the device | ✗ decays with the card ([model](../analysis/results_counterfactuals.md)) | ✓ but tied to one account | depends on the pinning contract | ✓ by design | ✓ replicated, expiry-aware |
| Retrievable by reference, from anywhere | ✗ physically attached | △ bucket URL, account-gated | ✓ CID | ✓ tx id | ✓ blob name + commitment |
| Anyone can resolve, not just the uploader | ✗ | ✗ IAM/billing walled | ✓ public gateways | ✓ | ✓ public reads |
| Serving reads is *compensated* — a gateway can earn for resolving | ✗ | ✗ you pay Amazon | ✗ pinning pays for storage, not serving | △ endowment, not per-serve | ✓ measured per-read via `blob_activities` |
| No keys or account on the capture device | ✓ (nothing to hold) | ✗ credentials required | △ pinning API keys | ✗ wallet to pay | ✓ uploads happen at the gateway |
| Live network with a metered economy *today* | — | ✓ | ✓ | ✓ | ✓ ([measured](../analysis/results_evidence.md) 2026-08-15: 393k blobs, 8.09M transactions) |

## The short version of each

- **microSD** is the capture's first home and stays that — the firmware
  writes there first. It is a cache, not an archive: survival decays
  multiplicatively, and nothing on the card can prove the bytes are
  unaltered.
- **S3** preserves but cannot *prove*: the account holder can edit or delete
  silently, retrieval is gated on that account's credentials and billing,
  and a field device would need cloud keys on it — a thing this design
  refuses to carry.
- **IPFS** gets content addressing right, and the pointer's commitment field
  is deliberately compatible with that model. What it lacks is the economic
  loop: pinning pays to *store*, not to *serve*, so there is no mechanism
  that rewards a gateway for resolving a stranger's pointer — the exact
  work the off-grid design depends on.
- **Arweave** is permanent storage done well, but permanence is the wrong
  shape for captures: field data is mostly valuable for months, not
  centuries, and paying perpetual-storage prices for it is overhead the
  workflow does not need. Shelby's expiry-aware model (the pointer carries
  `expires_at`) matches how captures are actually used.
- **Shelby** is the only option where the whole loop is native: content
  addressing for proof, public retrieval for resolution, expiry for
  realistic retention, and a serving economy that can pay the gateways that
  close the off-grid loop — already live and metered.

## The honest caveats

- Shelby is pre-mainnet (Early Access testnet). The evidence page numbers
  are real but testnet-scale, and there is no published token or pricing
  schedule yet. The 82-byte pointer is deliberately backend-agnostic — its
  commitment works over any content-addressed store — but the serving
  economy that makes gateways worth running is Shelby's, and it is the
  piece this project is betting on.
- Local analysis never needs Shelby: the analyzer reads a capture straight
  off the card. Shelby enters when a capture must outlive the card, be
  shared, or be reached from off-grid.
