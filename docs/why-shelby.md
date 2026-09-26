# Why Shelby — and why not the obvious alternatives

> **September 26 update:** This is an architecture comparison, not evidence
> that Shelby gateway compensation or a Lilyshark data business is live. The
> [current Shelby network](https://docs.shelby.xyz/protocol/architecture/networks)
> is a frequently wiped developer prototype, and [full tokenomics](https://docs.shelby.xyz/protocol/architecture/token-economics)
> remain unpublished. Content commitments verify bytes against a known
> commitment; they do not prove physical reception, location, or witness
> independence. Read the later [market analysis](strategy/lora-sniffing-market-analysis-2026-09.md)
> before using the commercial claims below.

The question a reviewer should ask: captures are just files — why not the SD
card, an S3 bucket, IPFS, or Arweave? This is the honest answer, requirement
by requirement. The workflow has two halves that constrain the choice:

- A **capture** can support an investigation when it retains raw bytes,
  settings, and provenance. A content commitment can verify those bytes on
  retrieval, but cannot establish that a radio originally heard them.
- A **pointer** is a reference that must resolve from anywhere, by anyone,
  asynchronously — including by a node that was off-grid when it heard it.

## The matrix

| Requirement | microSD | S3 / cloud bucket | IPFS + pinning | Arweave | **Shelby** |
| --- | --- | --- | --- | --- | --- |
| Check bytes against a commitment | ✓ with a separately kept hash | ✓ with a separately kept hash | ✓ CID | ✓ transaction reference | ✓ blob commitment |
| Retention independent of the device | ✗ unless copied elsewhere | ✓ while the account and policy remain active | depends on pinning | ✓ by design | proposed expiry-aware leases; prototype status applies |
| Resolve by reference | local access or copied file | bucket URL under its access policy | CID through available providers | transaction reference | blob name plus commitment, if the service is available |
| Public reads without uploader credentials | ✗ by itself | configurable | depends on providers | generally public | design goal; verify the current prototype |
| Serving incentive | ✗ by itself | operator pays for access | provider-dependent | storage endowment | proposed metered serving model; no verified Lilyshark revenue |
| Device needs service credentials | no | no if a phone/gateway uploads | no if a phone/gateway uploads | no if a phone/gateway uploads | no if a phone/gateway uploads |
| Operational maturity | local storage | established commercial service | provider-dependent | established network | [developer prototype](https://docs.shelby.xyz/protocol/architecture/networks); earlier testnet metrics are not a production SLA |

## The short version of each

- **microSD** is the capture's first home. A separately kept hash can detect
  later byte changes, but the card still needs backup and a retention plan.
- **S3** or a similar bucket can store committed bytes with retention and
  access policies. It needs an operator account and billing, though the field
  device can hand the upload to a phone or gateway.
- **IPFS** gets content addressing right, and the pointer's commitment field
  is deliberately compatible with that model. What it lacks is the economic
  loop in this proposal: pinning and serving depend on the chosen providers.
- **Arweave** is permanent storage done well, but permanence is the wrong
  shape for captures: field data is mostly valuable for months, not
  centuries, and paying perpetual-storage prices for it is overhead the
  workflow does not need. Shelby's expiry-aware model (the pointer carries
  `expires_at`) matches how captures are actually used.
- **Shelby** combines a blob commitment, expiry-aware storage, and a proposed
  metered serving economy in one design. Its current developer network is a
  prototype; neither long-term retrieval nor Lilyshark gateway revenue has
  been established by the earlier testnet measurements.

## The honest caveats

- Shelby is pre-mainnet; the documented `shelbynet` is a developer prototype
  that may be reset. The earlier evidence page numbers are prototype-scale
  observations, not durability or revenue guarantees. Shelby now publishes a
  [high-level token design](https://docs.shelby.xyz/protocol/architecture/token-economics),
  while saying full tokenomics and initial distribution will come later;
  no Lilyshark reward or live serving revenue is established by it. The
  82-byte pointer is deliberately backend-agnostic — its
  commitment works over any content-addressed store — but the serving
  economy that makes gateways worth running is Shelby's, and it is the
  piece this project is betting on.
- Local analysis never needs Shelby: the analyzer reads a capture straight
  off the card. Shelby enters when a capture must outlive the card, be
  shared, or be reached from off-grid.
