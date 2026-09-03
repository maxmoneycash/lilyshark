# Aptos Foundation ecosystem grant — application draft

Target: [Aptos Foundation Ecosystem Grants](https://aptosnetwork.com/grants),
$5k–$50k milestone-based band. This is the draft to submit, kept in the
repo so every claim in it can be checked against the commit it came from.

**Rule for this document: nothing aspirational is written in the present
tense.** Each claim below is either a link to code that exists, a
transaction hash anyone can look up, or a milestone explicitly marked as
future work. If a reviewer finds one sentence that overstates what is
built, the application deserves to fail.

## One-line summary

Lilyshark is a handheld LoRa mesh traffic analyzer — Wireshark for mesh
radio, on a $50 LILYGO T-Deck — that anchors its field captures on Aptos
so the evidence can be verified by anyone, and pays contributors in
non-transferable on-chain points for corroborated observations.

## What already exists (verifiable today)

| Claim | Where to check |
| --- | --- |
| GPL-3.0 firmware and web analyzer, public, live at lilyshark.com | [github.com/maxmoneycash/lilyshark](https://github.com/maxmoneycash/lilyshark) |
| `lilyshark::capture_registry` — anchors capture commitments on-chain | `contracts/capture-registry/`; deployed to shelbynet at `0x34946d…8728` |
| `lilyshark::field_points` — non-transferable points: witness corroboration and anchor claims | `contracts/field-points/`; 7/7 Move unit tests pass |
| Both modules published and exercised end to end on Aptos devnet | Publish `0xdea76b51…e8349d`; anchor `0x3537f1e9…41284`; claim `0x2a447b1d…769c70`; witness pair `0xed3ecd46…8aec25` / `0x731b8bd5…12e772`; resulting `points_breakdown` = (35, 10, 25, 1) |
| The browser publishes a capture to Shelby, anchors it, and verifies the round trip | `webapp/services/pulse-api/`, `webapp/src/components/TrafficTab.tsx` |
| 82-byte `SHLB` pointer format, golden-vectored across C++, TypeScript, Python | `docs/shelby-pointer-format.md` + three implementations + tests |
| Witness-key derivation frozen and golden-vectored across the same three languages | `docs/protocol/field-receipts.md` (`WITNESS-VECTOR-1`), `scripts/field_receipts.py`, `src/shelby/witness_key.cpp`, `webapp/src/lib/witnessKey.ts` |
| Deterministic season scorer over public chain events | `scripts/field_receipts_score.py`, 32 tests |
| Measured mesh-capacity research behind the design | `analysis/`, and the 63-page whitepaper on the site's PAPER tab |

Devnet is periodically wiped, so those transactions are a dated proof that
the path works, not a durable deployment. Making it durable is Milestone 1.

## What we are asking to fund

Four milestones, each with a public artifact a reviewer can check. Total
request: **$25,000** — the middle of the ecosystem band, sized to the work
below rather than to the ceiling.

**Milestone 1 — Durable deployment and registry v2 ($5,000).**
Publish `capture_registry` and `field_points` to Aptos testnet (and
mainnet when the score is worth its gas), with commitment de-duplication,
ranged views so clients stop downloading whole registries, and a
wallet-signed path so a user anchors under their own account instead of
the service's. *Artifact: deployed addresses, transaction hashes, and the
migration note in `contracts/*/README.md`.*

**Milestone 2 — Move Prover invariants ($4,000).**
Prover specifications for the scoring modules: points never decrease,
claimed anchors never exceed the registry count, one attestation per
account per witness key, credited amounts match the frozen schedule; run
in CI. *Artifact: passing prover run in the repo's GitHub Actions.*

**Milestone 3 — Contributor surfaces in the analyzer ($9,000).**
Witness attestation from an opened capture, per-frame corroboration state,
and a season leaderboard rendered from chain events via the Aptos indexer
— the loop that makes the on-chain data visible to non-crypto users.
*Artifact: shipped on lilyshark.com, with the tasks' acceptance rubrics
met (`tasks/ui/ui-014`, `ui-015`).*

**Milestone 4 — Season 0, run in public ($7,000).**
Publish the frozen season rules (already drafted at
`docs/protocol/season-0.md`), run one quarter of real contributor
activity, publish the scorer output and a written post-mortem including
what the sybil-clique analysis found. *Artifact: the season's public
standings and the post-mortem.*

## Why this is worth funding to Aptos specifically

- **It brings a non-crypto audience onto Aptos rails.** The users are RF
  operators, ham licensees, and mesh hobbyists — people hostile to
  marketing and allergic to tokens. The chain is present as
  infrastructure for verifiable evidence, not as a speculation surface.
  Nothing in the design requires the user to hold or trade anything.
- **It exercises Shelby end to end.** Lilyshark is a real workload for
  Aptos Labs' storage network: content-addressed blobs, expiry-aware
  leases, public reads, with the on-chain anchor tying them to a
  publisher. The whitepaper's evidence section is a measured study of
  that network at testnet scale.
- **It is deliberately token-free.** Points are non-transferable by
  construction: no transfer function, no supply, no market. That is a
  design choice documented in `docs/protocol/field-receipts.md` and
  argued from the DePIN failure record — a network that pays for
  hardware presence gets spoofed hardware. We would rather be the
  example that shows on-chain verification working without an emission
  schedule.
- **The work is already shipping.** The repository shows a task board
  where each item carries its own acceptance rubric and eval commands
  (`python3 scripts/tasks.py board`), CI that fails on regressions, and
  a whitepaper-to-code traceability matrix that states plainly what is
  built and what is not. Grant money accelerates a project that is
  moving, not one that starts on funding.

## What we will not claim

- Shelby has no token and no mainnet, so this application asks for
  nothing that depends on either.
- No user-facing token, airdrop, or points-to-money conversion is
  planned or promised; if that ever changes it will be a separate,
  publicly argued decision with legal review.
- Hardware validation of the T-Deck firmware is incomplete (tasks
  FW-001/002/008) and is not part of this request.

## Submission checklist

- [ ] Milestone 1 started (durable testnet deployment) so the application
      shows momentum rather than a plan
- [ ] Links checked: repo, live site, contract READMEs, devnet txs
- [ ] Contact and payout details filled in on the Foundation's form
- [ ] Application archived here with its submission date and outcome
