# Direction, 2026 Q3 — where the mesh moved, where we focus, how this pays

This memo settles three questions with evidence: what changed in the mesh
world, what Lilyshark should be, and where the money is. The work it
commits to lives on the [task board](../../tasks/README.md); the protocol
it introduces is specified in
[field-receipts.md](../protocol/field-receipts.md). Sources were pulled
August 2026; links inline.

## 1. What actually happened to the mesh world

**Meshtastic hit its scaling wall in public.** Managed flood routing tops
out around 50–100 active nodes per channel; DEF CON demonstrated collapse
at ~2,000, and the January 2026 Hacker News thread on Reticulum
([349 points](https://news.ycombinator.com/item?id=46686273)) reads as
migration testimony — "mostly unusable", "everything beyond 1 hop is often
unusable". Add CVE-2025-52464 (CVSS 9.5, duplicated DM keys, June 2025)
and trademark enforcement against community groups, and the drift is
overdetermined.

**MeshCore has the growth.** Created January 2025; ~3.5k GitHub stars,
[38,000+ mapped nodes and 100k+ app users by spring 2026](https://blog.meshcore.io/2026/04/04/meshcore-map)
on source-routed repeater/room-server architecture — despite an April 2026
trademark-and-forked-firmware governance split. Two facts matter to us:
city meshes are consolidating on it, and its official apps are closed
with a **paid (~£8) premium T-Deck firmware** — proof that this exact
community pays for exactly our hardware target, and an open-source
opening, since that closedness is its most criticized trait.

**Reticulum owns the serious end and just decentralized itself.** RNS
1.0.0 shipped fall 2025; the founder withdrew from community management in
December 2025 ("Carrier Switch"), and the ecosystem reorganized around
forks (RetiNet, Reticulum-rs, microReticulum) — momentum without a
gatekeeper. The FOSDEM 2026 community meetup named its gaps: no beginner
docs, thin observability, no formal spec, and **no analyzer tooling at
all** beyond `rnstatus`/`rnpath` CLI probes.

**The competitive map, checked project by project:** Meshtastic has half a
dozen sniffers/dissectors (meshtastic-wireshark, stridetastic, meshpoint…).
MeshCore has capture terminals and dashboards. **Reticulum has nothing** —
no dissector, no GUI analyzer, no airtime analytics. Encryption-by-default
limits payload reading, but announces, link establishment, path dynamics,
and airtime are all observable and completely unserved.

## 2. Focus: the instrument for a multi-protocol transition

The community is mid-migration and will run mixed RF environments for
years. Nobody's tool shows all three protocols on one screen with the raw
RF underneath — except ours, which was built protocol-agnostic from the
first commit. So the focus is not "pick the winning protocol"; it is
**own the observability layer of the transition**:

1. **Become the Reticulum analyzer that doesn't exist.** Deepen the
   RNode/Reticulum decoder from structural to semantic: announce parsing,
   destination-hash tracking, link/path event timelines, per-identity
   airtime — all observable without keys. First mover in an explicitly
   named gap, and instant relevance to the most technical community in
   mesh. (Tasks UI-01x, FW-01x.)
2. **Ride MeshCore's growth with open tooling.** Their repeater/room
   topology is *designed* for the kind of health monitoring their closed
   apps don't provide. An open MeshCore network-health view makes
   Lilyshark the diagnostic tool for the fastest-growing mesh. (UI-02x.)
3. **Keep Meshtastic coverage current** — it is still the largest installed
   base and the richest source of capturable traffic today.

"Wireshark for mesh radio" was the right instinct; the market data now
says the same thing with numbers.

## 3. The protocol and the token question, answered honestly

The branch that asked for this work said "build DeFi with the Shelby
token." Finding, checked against primary sources August 2026: **there is
no Shelby token.** Shelbynet is an Early Access prototype chain that is
[wiped roughly weekly](https://docs.shelby.xyz/protocol/architecture/networks);
payments use faucet ShelbyUSD, explicitly valueless; tokenomics are
"later in 2026" promises. Anything sold today as "Shelby token DeFi"
would be fiction. What Shelby *does* have is the read-compensated storage
economy our whitepaper bet on, live at prototype scale — the bet stands,
the token trade does not exist yet.

So the protocol work is sequenced to be real at every step —
**[Field Receipts](../protocol/field-receipts.md)**: witness attestation
(two independent receivers corroborating one transmission — the primitive
Helium's proof-of-coverage needed and faked), coverage cells with
novelty-weighted scoring (Hivemapper's proven mechanic), and
non-transferable on-chain points
([contracts/field-points](../../contracts/field-points/)). The DePIN
record is unambiguous: networks that paid tokens for supply before demand
died of it (Helium: ~25k denylisted spoofed hotspots, 60% network
shrinkage, an SEC suit; sector-wide 2025 on-chain revenue a mere ~$72M
against tokens 94–99% off their highs). The ones that thrived either sold
real data for real money (GEODNET: ~$7.3M ARR) or never needed a token at
all (Flightradar24: feed data → free premium, 40–50k receivers). Points
now; conversion only if and when there is real value to distribute.

One operational consequence of the weekly wipe: the shelbynet deployment
of `capture_registry` is ephemeral. Durable anchoring and the points
ledger belong on Aptos (testnet now, mainnet when it matters), with Shelby
holding the blobs; the pointer format doesn't change (CO-004).

## 4. How this makes money

Ranked by evidence and nearness, all compatible with GPL firmware and an
open protocol:

1. **Feed-to-unlock premium analyzer** (Flightradar24's loop, inverted
   WiGLE). lilyshark.com stays free for live capture and inspection;
   history, multi-capture correlation, alerting, API, and team workspaces
   are paid — free for accounts that feed N verified capture-hours a
   month. Contributors are the product's data supply; non-contributing
   professionals (site surveyors, EmComm, vendors debugging deployments)
   are its paying demand.
2. **Pre-flashed hardware.** A flashed-and-tested "Lilyshark T-Deck"
   at margin, plus discounted units into empty coverage cells
   (Flightradar24 ships receivers into gaps weekly; MeshCore charges £8
   for firmware alone). Hardware is also the acquisition funnel.
3. **Coverage and spectrum data products.** Aggregated, cell-level RF
   coverage, protocol mix, and interference data — the dataset Field
   Receipts verifies — licensed to vendors, LoRaWAN operators, and
   researchers. GEODNET-shaped, hobby-scaled; season points are the
   published revenue-share key back to contributors.
4. **Grants.** Aptos Foundation ecosystem grants ($5k–$50k,
   milestone-based) fit the contracts work today; Shelby has no grants
   program yet but runs a developer Early Access we're already inside.
   NLnet/NGI Zero fit the open-protocol work.
5. **Events and sponsorship.** WiGLE-style capture competitions at ham
   fests and DEF CON's wireless village — cheap, on-brand, and the
   leaderboard infrastructure is the same code as Season 0.

Not doing: issuing a token (securities exposure against zero product
revenue), paid closed firmware (the exact resentment MeshCore is
generating), and ads.

## 5. The 90-day shape

- **Weeks 1–4:** Field Receipts primitives land (witness keys in
  scripts/webapp with golden vectors, `field_points` compiled and
  deployed to Aptos testnet); TRAFFIC gets display filters — the most
  requested Wireshark-class gap in the analyzer.
- **Weeks 5–8:** Reticulum announce/path decoding ships on device and
  web; leaderboard + coverage map read chain events; Season 0 rules
  published.
- **Weeks 9–12:** Season 0 opens with a capture competition; premium
  tier scoped; Aptos grant application submitted with the deployed
  contracts and live leaderboard as evidence.

Everything above is broken into evaluable tasks on the
[board](../../tasks/README.md) (`python3 scripts/tasks.py board`).
