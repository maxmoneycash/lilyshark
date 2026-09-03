# Whitepaper ↔ repository traceability

The whitepaper ("The Growth Trap in Proof of Physical Work", v1.0,
2026-08-07, 63 pp — the PAPER tab and
`webapp/public/lilyshark-whitepaper.pdf`) is a research report: it measures
mesh capacity, ranks verification tiers, and specifies a protocol it would
fund. It is **not** a spec for the Lilyshark device — the product's own
claims live in `docs/` and `analysis/`. This matrix keeps the two honest
against each other: what the paper claims, where the repo embodies it, and
where the repo deliberately diverges.

Status legend: **built** (in the repo, tested) · **evidence** (the repo
contains the measurement itself) · **partial** · **not built** (and said
out loud) · **diverges** (we disagree, with the argument written down).

## Part IV evidence — the measurements the product stands on

| Paper claim | Where | Status |
| --- | --- | --- |
| R = 7.36 rebroadcast factor, measured against Meshtastic's own simulator (§29) | measured input to `analysis/mesh_shelby_scaling.py` (reported in `analysis/results.md`); quoted by `docs/shelby-pointer-format.md`, `docs/shelby-off-grid.md`, the README, `docs/protocol/field-receipts.md`, and the INTRO beats | **evidence** — the paper's principal contribution is this repo's own model |
| Reach collapse 68.6% → 25.8% as nodes are added (§31) | the paper's own measurement (the PAPER tab ships the PDF); quoted by `docs/shelby-off-grid.md`, `docs/shelby-pointer-format.md`, the README, and the INTRO beats — not reproduced in `analysis/` | **evidence (paper only)** |
| ~200 B usable payload; blob-over-air is 12,633 channel-seconds vs 6.2 s for its pointer (§34) | `analysis/results.md`; motivates the 82-byte pointer | **built** — the pointer format is the productized conclusion |
| Transit demand saturates at 6,721 nodes; one collision domain ceiling ~$14k/yr (§30) | the paper's own measurement (the PAPER tab ships the PDF); the 6,721 figure is quoted in the INTRO beats — not reproduced in `analysis/`, and the ~$14k/yr ceiling is quoted nowhere else in the repo | **evidence (paper only)** |
| Shelby dependency risk: pre-mainnet, no published token terms (§21) | `docs/why-shelby.md` caveats; `analysis/results_evidence.md` (393k blobs, 8.09M txs, dated 2026-08-15) | **evidence** — and the caveat now extends to shelbynet's weekly wipe (task CO-003, PA-004) |

The same numbers are quoted on several surfaces (README, docs, INTRO);
task **PA-003** pinned each quote to its source — `analysis/results.md`
for the model figures, the paper for reach and saturation, and
`analysis/results_evidence.md` (snapshot-dated) for the network numbers.

## Part I–II framework — the verification ladder

| Paper claim | Repo reality | Status |
| --- | --- | --- |
| Three-tier ladder: coverage < delivery < observation; tier predicts revenue (§3–§8) | Adopted as the design frame for [Field Receipts](protocol/field-receipts.md): witness attestation is *observation-tier* evidence (two independent receivers corroborating a transmission), not coverage-tier presence | **built (as design law)** — task PA-002 makes the argument explicit in the spec |
| **Decline** any incentive layer on managed-flood routing (§5, §12) | Field Receipts rewards no routing and adds zero airtime; it pays for corroborated observation and anchored evidence only | **built** — this is compliance with the paper, not divergence; PA-002 documents it |
| Adversarial behaviour under payment (§33) | Threat model in the protocol spec; sybil-clique measurement is task PR-007 | **partial** |

## Part III — the protocol the paper would fund (MERIDIAN, §19–20)

| Paper element | Repo reality | Status |
| --- | --- | --- |
| Receive-only GNSS-interference observation network, $260 BOM, H3-cell demand-weighted rewards | Not in this repo. Lilyshark is the mesh instrument; MERIDIAN is an investment recommendation addressed to funders | **not built** — task PA-005 states this gap in one place so it never reads as vaporware — see [meridian-gap.md](meridian-gap.md) |
| Genesis gate: no token emission before the first paying contract (§20) | Adopted as policy: `field_points` are non-transferable, no token exists or is promised; see [strategy memo §3](strategy/2026-q3-direction.md) | **built (as policy)** |
| Token spec: 42,048,000 cap, no premine, halving emission | Not built, deliberately — the sequencing in the strategy memo says points now, conversion only against real value | **not built, by the paper's own gate** |
| Move Prover invariants for score-keeping modules | `field_points` has unit tests specified (CO-001); prover specs are task CO-005 | **partial** |
| Aptos over Solana (§18, §36) | `capture_registry` and `field_points` are Move on Aptos rails | **built** |

## Product claims outside the paper (docs/ and screens)

| Claim | Where made | Status |
| --- | --- | --- |
| 82-byte SHLB pointer, golden-vectored across C++/TS/Python | `docs/shelby-pointer-format.md` + three implementations + tests | **built** |
| Capture → Shelby blob → on-chain anchor, each step checkable | Registry deployed to shelbynet; analyzer RESOLVE trace verifies all steps | **partial** — browser publishes don't anchor yet (UI-002), and shelbynet anchors are wiped weekly (CO-003) |
| No keys or account on the capture device; a connected host (share service or `shelby-put.ts`) pays for uploads | SHELBY tab step 02; `docs/why-shelby.md` matrix | **built** — UI-001 replaced the earlier "paid for from the device's own Aptos account" overclaim with the real flow |
| Always-on pointer-resolving gateway | `docs/shelby-off-grid.md` says "next, not yet shipped" | **not built, said out loud** — stays that way |
| Hardware validation: SD writes, touch calibration, scan recovery | README status note | **not built (unverified)** — FW-001/FW-002/FW-008 |

## The rule this file enforces

A claim may live in three states: built with evidence, not built and
labeled, or disagreed with in writing. The fourth state — implied and
unverifiable — is the one this matrix exists to catch. Update it whenever
a task above lands; `python3 scripts/tasks.py eval --all` checks the
mechanical half.
