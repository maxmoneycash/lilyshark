# The MERIDIAN gap — what the paper specifies and this repo does not build

The whitepaper's Part III (§19–20) specifies a complete protocol the
authors would fund. This repository does not contain it, and is not going
to unless the conditions at the bottom of this page are met. This document
exists so the gap is stated in one place rather than discovered — per the
rule the [traceability matrix](whitepaper-traceability.md) enforces,
not-built-and-labeled beats implied.

## What §19–20 specify

**MERIDIAN** (a working name the paper itself says should be replaced
before anything is filed): a receive-only GNSS-interference observation
network on Aptos. A node is a ~$260 receiver package registered as a Move
resource bound to a hardware attestation key. Each epoch it submits
per-satellite carrier-to-noise ratios, AGC trend, an RF spectrum snapshot,
and carrier-phase double differences; observations are cross-checked
against published ephemeris and against every other node observing the
same satellites in the same window. Buyers — aviation authorities,
insurers, maritime operators, defence — burn tokens for non-transferable
credits to query the interference picture.

The token design is fully specified: 42,048,000 maximum supply (the
geometric sum of the schedule, no premine, no genesis VC allocation);
1,200 tokens/hour at genesis halving every two years; distribution split
competitively across H3 cells weighted by marginal information value, with
per-cell emission scaling with paid queries against that cell; a
burn-to-credits sink; and a **genesis gate** — no emission until the first
paying contract is signed. §19 also specifies six Move Prover invariants
(emission ceiling, genesis gate, supply cap, registry uniqueness, credit
conservation, no admin mint) that turn the tokenomics from a document into
a machine-checked artefact. Storage is Shelby; backhaul is DoubleZero.

It is a specification addressed to funders — "the protocol we would fund"
— written to be falsifiable (§5 gives it a dated prediction: a GNSS
interference monitoring network raises institutional capital by end 2027).
It is not a description of the Lilyshark product.

## What this repo adopts from it

The parts that are design law rather than product scope carried over:

- **The genesis gate, as policy.** No token exists or is promised;
  `field_points` are non-transferable by construction, and conversion to
  anything of value waits for real value to distribute
  ([strategy memo §3](strategy/2026-q3-direction.md)). This is the paper's
  no-emission-before-demand rule applied to a network that does not even
  have a token to gate.
- **Observation-tier verification.** [Field Receipts](protocol/field-receipts.md)
  rewards independent corroboration of a signal heard — the paper's
  highest verification tier (§3) — via witness attestation, not
  coverage-tier presence claims. This is MERIDIAN's inter-node agreement
  check, rebuilt for LoRa frames instead of GNSS epochs.
- **Aptos/Move rails.** `capture_registry` and `field_points` are Move
  modules, per the paper's Aptos-over-Solana argument (§18, §36).
- **Prover-invariant discipline.** §19's argument that score-keeping
  modules should carry machine-checked invariants, not comments, is
  adopted as task **CO-005** (prover specs for `field_points`). Partial
  today: unit tests exist, prover specs do not.

## What this repo deliberately does not build

- **The GNSS network.** No receiver hardware, no observation pipeline, no
  ephemeris cross-check, no H3 cells, no interference data product.
  Lilyshark is a mesh-radio instrument; MERIDIAN is an investment
  recommendation addressed to investors, and it stays addressed to them.
- **Any token.** No supply, no emission schedule, no premine question,
  because there is no token — see the strategy memo for why (securities
  exposure against zero product revenue, and the DePIN record on
  paying for supply before demand). The paper's own genesis gate agrees:
  nothing should be emitted before a buyer exists, and no buyer exists.

A reader who arrives from §19 expecting the token module on-chain will
find a 95-line capture registry and a non-transferable points module.
That is the intended state, not an unfinished one.

## What would change this

Scope changes here happen on the [task board](../tasks/README.md) or not
at all. GNSS-interference observation would enter this repo only as
evaluable tasks with the same discipline as everything else — and, by the
paper's own gate, serious work on it would follow a paying counterparty
for the data, not precede one. Until such tasks exist, §19–20 remain what
they say they are: a recommendation to funders, marked
**addressed-to-investors**, not a product commitment.
