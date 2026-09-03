# Season 0 events — the capture competition kit

WiGLE has kept RF people wardriving for twenty years on leaderboards and
event competitions alone, with no token in sight; DEF CON's Wireless
Village runs the same mechanic annually. Season 0 borrows it directly.
This is the kit for running a Lilyshark capture competition — at a ham
fest, a hackerspace, a village, or as a distributed weekend — scored by
the same rules and the same published scorer as the season itself.

Scoring, weights, and redemption are **not** redefined here. They live in
[docs/protocol/season-0.md](../protocol/season-0.md) and are frozen for
the season; this document is the event wrapper around them.

## The one rule that shapes everything

**This is a listening competition. Nobody transmits to score.**

Every point in Season 0 comes from hearing traffic that was already on
the air: witness corroboration, anchored captures, cell coverage. No
scoring event requires a transmission, and organizers should say so out
loud at the start of each event. This is deliberate — it keeps the
competition legal for unlicensed participants in most jurisdictions, and
it keeps the mesh's shared airtime out of the incentive loop, which is
the whitepaper's central finding (§29–31: a flooded mesh already spends
R = 7.36 transmissions per delivered message; paying people to add more
would be funding the collapse).

## Event formats

**1. The Walk (2–4 hours, in-person).**
A bounded area — a conference venue, a downtown, a hill loop. Contestants
carry a T-Deck, capture whatever is on the air, and publish at the end.
Wins the cells nobody else reached. Best format for a first event: short,
social, and it produces overlapping receptions, which is where witness
corroboration comes from.

**2. The Overnight (24 hours, distributed).**
Run a static receiver at home for a day. Rewards patience and good
antenna placement rather than mobility, and it is the format that
produces the most corroboration pairs, because static receivers overlap
with everything mobile that passes.

**3. The Expedition (a weekend, distributed).**
Score weighted toward previously unsurveyed cells: the
[most-wanted list](../../scripts/field_receipts_score.py) (`most-wanted
--markdown`) is published at the start, and it names where the gaps are.
Flightradar24's most-wanted receiver map, applied to LoRa.

## Entry rules

1. **Register an Aptos account.** Points accrue to it; it is the only
   identity the competition has. One account per person — the season
   scorer down-weights closed witness cliques, and organizers may
   disqualify obvious multi-accounting, but the protocol prices sybils
   rather than pretending to prevent them.
2. **Capture with Lilyshark firmware** on a T-Deck (or the analyzer with
   a linked device). Any radio profile, any band you are licensed to
   receive.
3. **Publish and anchor before the deadline.** A capture that is not
   anchored on-chain by the closing timestamp does not exist for scoring.
   Chain event timestamps decide inclusion — not when you say you
   captured.
4. **No synthetic frames, ever.** Simulated traffic carries a provenance
   flag that the firmware, the analyzer, and the tooling all refuse for
   witness keys. Submitting synthetic captures as field data is the one
   disqualifying offense.
5. **Do not transmit to farm points.** Replaying frames you heard is
   both a licensing question and, per the threat model, a low-yield
   attack — but it is also against the spirit of a listening
   competition. Organizers should disqualify it when they see it.
6. **Everything is public.** Anchored captures are public blobs; the
   standings are computed from public events. Do not capture anything you
   would not publish, and see the privacy note below.

## Scoring on the day

Run the published scorer — no organizer discretion, no private
spreadsheet:

```sh
python3 scripts/field_receipts_score.py score \
  --events events.json --cells cells.json > standings.json
```

Publish `standings.json` alongside its inputs. Disputes are settled by
re-running it; that is the whole trust model. An organizer who adjusts
scores by hand has ended the competition's credibility, not resolved a
dispute.

For a live event, run it at intervals and project the standings. The
[leaderboard panel](../../tasks/ui/) (task UI-015) will render the same
data from chain events once it ships; until then the JSON and a terminal
are enough.

## Prizes

Prizes cost **access or hardware, never money and never tokens**:

- Pre-flashed T-Decks (funded from hardware margin — see
  [hardware-offering.md](hardware-offering.md)), ideally awarded to
  people in the emptiest cells, which is Flightradar24's receiver
  program in miniature.
- Premium analyzer access when it exists
  ([premium-tier.md](premium-tier.md)).
- Permanent named credit: the leaderboard and per-cell "first surveyed
  by" attribution are the prize that lasts.
- Physical trophies and stickers cost nothing and work — WiGLE's
  longevity is evidence.

Do not award cash or anything convertible to it. The moment a
competition pays money for captures, every anti-spoofing question gets
harder and the legal posture changes.

## Legal notes for organizers

Not legal advice; organizers are responsible for their own event.

- **Receiving is generally permissible; interception rules vary.** In
  the US, the ECPA (18 U.S.C. §2511) permits receiving radio
  transmissions that are readily accessible to the general public, but
  divulging the *contents* of intercepted communications can be a
  separate matter — so the competition scores metadata and corroboration,
  not message contents. In the UK, the Wireless Telegraphy Act 2006
  §48 makes it an offence to receive messages not intended for you and
  to disclose them. Several EU states have similar provisions. Check
  your jurisdiction before publishing captures that contain readable
  payloads.
- **Practical consequence:** encourage participants to capture on public
  mesh channels, and remind them that publishing a capture publishes its
  bytes. The analyzer can decrypt Meshtastic's *published default key*
  traffic — which was never private — but a participant who enters a
  private channel key is looking at traffic that was intended to be
  private, and publishing that is their decision and their liability.
- **Location privacy.** Cells are geohash-5 (~5 km) precisely so the
  coverage map does not publish anyone's address. Do not require finer
  location for scoring, and do not publish per-frame GPS.
- **No transmitting means no licensing question for participants** in
  most jurisdictions — which is why the format is what it is. If an
  event includes any transmitting demo, it needs a licensed operator
  and it is outside the competition.

## Running one: the checklist

- [ ] Announce ≥2 weeks ahead with the frozen rules linked, not summarized
- [ ] Publish the most-wanted cells for the area at announcement
- [ ] Confirm participants have flashed devices and funded Aptos accounts
      *before* the day (this is the step that eats event time)
- [ ] State the listening-only rule and the publication warning at the start
- [ ] Set the closing timestamp in UTC, and say which chain events count
- [ ] Run the scorer publicly; publish standings with inputs
- [ ] Write up what happened — including what was gamed, because the next
      season's rules are only as good as the last season's post-mortem
