# Pre-flashed Lilyshark T-Decks — the offering, scoped

Revenue stream #2 from the [direction memo](2026-q3-direction.md): sell a
T-Deck that arrives flashed, tested, and ready to capture. MeshCore charges
around £8 for *firmware alone* on this exact device, which settles the
question of whether this community pays for convenience on this hardware.
Ours is GPL-3.0 and free to flash yourself — what is being sold is a tested
unit and the hour you do not spend fighting esptool.

**Gate: this does not launch until [FW-001](../../tasks/firmware/) is done.**
Shipping hardware whose microSD writes, touch calibration, and scan
recovery have never been verified on a physical device would be selling an
unknown. The QA checklist below is written against the validation FW-001
performs; until it passes, there is nothing to sell.

## What ships

| Tier | Contents |
| --- | --- |
| **Analyzer** | LILYGO T-Deck Plus, flashed with a tagged Lilyshark release, QA'd per the checklist below, microSD card inserted and write-tested, printed card with the source URL and the exact build ref |
| **Analyzer + gap credit** | The same unit, discounted or free, shipped to an applicant in a most-wanted cell (below) |

No custom enclosure, no bundled antenna upgrades, no accessories in v1 —
each one adds a supply chain and a support surface for margin that isn't
there yet.

## Per-unit QA checklist

Derived from `scripts/preflight_tdeck.sh` (host-side checks, already
automated) plus the on-device pass FW-001 defines. Every unit gets all of
it, and the results are recorded per serial:

**Before flashing (automated, `scripts/preflight_tdeck.sh`):**
- [ ] Factory image present, ESP32 magic `0xE9`, non-empty
- [ ] SHA-256 matches the single factory entry in `dist/SHA256SUMS`
- [ ] Port enumerated and identified as the T-Deck

**After flashing (on-device, one operator pass):**
- [ ] Boots to the Lily Pink wordmark; About shows the expected version
- [ ] Display, keyboard, trackball, touch all respond
- [ ] SX1262 initializes with error 0 and receives on the shipped profile
- [ ] microSD write verified: record a short capture, confirm the `.lscap`
      opens in the analyzer and its bytes round-trip
- [ ] GPS acquires (or is explicitly reported absent for non-Plus units)
- [ ] Battery reads plausibly on charge and on battery
- [ ] Spectrum scan runs and cancels cleanly, radio returns to receive

**Record kept per unit:** serial, firmware ref and image SHA-256, date,
operator, and each result. A unit that fails any line does not ship.

## Margin model

**The unit-cost figures below are placeholders and must be confirmed
against a live LILYGO quote before anything is listed for sale.** They are
the shape of the model, not a price sheet.

| Line | Placeholder | Notes |
| --- | --- | --- |
| T-Deck Plus, single-unit retail | ~$75 | Confirm; bulk pricing is the whole question |
| T-Deck Plus, 10–25 unit lot | ~$65 | Assumed ~15% off single-unit; unverified |
| microSD card (32 GB) | ~$5 | |
| Flash + QA labor | ~$12 | 30 min/unit at a modest rate; the checklist above is the 30 min |
| Packaging, printed card | ~$3 | |
| Shipping (domestic) | ~$10 | Charged separately, not margined |
| **Landed cost (lot of 25)** | **~$85** | Excluding shipping |
| **List price** | **$129** | |
| **Gross margin/unit** | **~$44 (34%)** | Before payment fees, returns, support |

Break-even on a 25-unit lot is **~13 units** against the lot's own cost;
the first lot also absorbs one-time setup (jig, listing, docs), so treat
the first lot as break-even at best and the second as the real test.

Sanity check on demand before committing capital: if a pre-order page
cannot collect 10 deposits, the market is telling you to keep flashing
being free and skip the inventory.

## Gap credits — hardware as an acquisition channel

Flightradar24 ships free receivers weekly to people in coverage gaps
because a receiver in an empty cell is worth more than its margin. Same
logic here, at hobby scale:

- Publish the [most-wanted cells](../../scripts/field_receipts_score.py)
  (`most-wanted --markdown`) alongside the store.
- Applicants in a most-wanted cell get a discount, or a free unit when
  margin from paid sales allows it, in exchange for keeping it running
  and publishing captures.
- Fund it strictly from realized margin, never from expected margin.

## GPL compliance — non-negotiable

Selling a device running GPL-3.0 firmware carries obligations, and this
project has no interest in the edges of them:

- Every unit ships with the **exact source ref** of the flashed build —
  git tag and commit SHA on the printed card, matching the About screen.
- The corresponding source stays publicly available at that ref; if the
  repository ever moves, buyers get a written offer valid for three years
  as GPL-3.0 §6 requires.
- Buyers can rebuild and reflash: the release is reproducible
  (`scripts/verify_reproducible_release.sh`) and the flashing route is
  documented (`docs/FLASHING.md`, plus the browser flasher).
- **No locked bootloader, no signed-firmware lockout, no "premium
  firmware" tier.** The thing being sold is a tested unit, not access to
  the software — that distinction is the whole ethical difference from
  the paid-closed-firmware pattern this project criticizes elsewhere.

## Open questions before launch

1. Real LILYGO lot pricing and lead time.
2. Who does fulfillment — self-ship, or a partner? Support burden is the
   hidden cost of hardware, not the BOM.
3. Jurisdiction: selling a receiver is generally unregulated, but check
   import/CE/FCC posture for the destinations you actually ship to.
4. Returns and warranty policy, written before the first sale, not after
   the first failure.
