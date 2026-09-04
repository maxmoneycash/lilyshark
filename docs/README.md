# Lilyshark documentation

**[The system on one page →](../webapp/public/docs/diagrams/lilyshark-architecture.html)**
An interactive map of the whole thing: the air, the radio, the three protocol
decoders, and the three places you can read them from.

**[Pairing a phone to a deck →](../webapp/public/docs/diagrams/pairing-sequence.html)**
The Meshtastic BLE conversation in the order it actually happens — the config
dump, the channel list that carries names and no keys, and which messages the
deck refuses to forward.

Both are generated from typed sources in `diagrams/` by
`scripts/build_diagrams.sh`.

Everything below is grouped by what you are trying to do, because that is how
people arrive at documentation. If you already know the file you want, the
[full list](#every-document) is at the bottom.

---

## I want to try it

| Read this | Why |
| --- | --- |
| [quickstart.md](quickstart.md) | Evaluate the project in ten minutes. **No radio required** — it runs in a simulator. |
| [FLASHING.md](FLASHING.md) | Put the firmware on a real T-Deck. Start here once you have hardware. |
| [hardware.md](hardware.md) | What a T-Deck is, what is inside one, and what else you need. |
| [DEMO.md](DEMO.md) | Driving the demo, for a walkthrough where nothing may go wrong. |

## I want to get on the mesh

| Read this | Why |
| --- | --- |
| [join-the-mesh.md](join-the-mesh.md) | Joining a real network, and what to expect on your first day. |
| [related-networks.md](related-networks.md) | Meshtastic, MeshCore and Reticulum: what each is, and how they differ. |
| [what-you-can-see.md](what-you-can-see.md) | What is actually readable off the air, and what is not. |
| [meridian-gap.md](meridian-gap.md) | Why coverage has holes, and where they are. |

## I want to understand how it works

| Read this | Why |
| --- | --- |
| [architecture.md](architecture.md) | Firmware, tooling, web app and wire formats, on one page. |
| [channel-key-security.md](channel-key-security.md) | How channel keys are stored and used — and what the deck refuses to do with them. |
| [shelby-off-grid.md](shelby-off-grid.md) | The off-grid design: blobs over a 200-byte pipe, end to end. |
| [why-shelby.md](why-shelby.md) | Why Shelby and not the SD card, S3, IPFS or Arweave. The honest matrix. |

## I am writing code against it

Cross-language wire formats, each pinned by golden test vectors. Every
implementation — C++, TypeScript, Swift, Python — accepts exactly the same
bytes, and a change that breaks that fails a test on a desk rather than a
radio in a field.

| Read this | Format |
| --- | --- |
| [lilyshark-capture-format.md](lilyshark-capture-format.md) | `.lscap` — the native capture format |
| [shelby-pointer-format.md](shelby-pointer-format.md) | `SHLB` — the 82-byte off-grid pointer |
| [lsk-ble-contract.md](lsk-ble-contract.md) | `LSK` over USB, and the Meshtastic BLE service |
| [RECORDING_UI.md](RECORDING_UI.md) | Recording the interface, for docs and for regression frames |

## Evidence and method

The quantitative case, kept separate from the claims it supports.

| Where | What |
| --- | --- |
| `analysis/` (repo root) | Scaling model, counterfactual failure models, and **measured evidence from the live Shelby network**. Start at `analysis/README.md`. |
| [whitepaper-traceability.md](whitepaper-traceability.md) | Every claim in the whitepaper, traced to the code or measurement behind it. |
| [protocol/field-receipts.md](protocol/field-receipts.md) | How a field receipt is produced and what it proves. |
| [protocol/witness-graph-method.md](protocol/witness-graph-method.md) | The witness graph, and its method. |
| [protocol/season-0.md](protocol/season-0.md) | Season 0, with its rules in `protocol/season-0-rules.json`. |

## Plans and direction

Forward-looking, and therefore the first things to go stale. Dated where it
matters.

| Read this | About |
| --- | --- |
| [meshcore-participation-plan.md](meshcore-participation-plan.md) | Participating in MeshCore properly, rather than merely decoding it. |
| [strategy/2026-q3-direction.md](strategy/2026-q3-direction.md) | Where this is going. |
| [strategy/hardware-offering.md](strategy/hardware-offering.md) | What a hardware offering would be. |
| [strategy/premium-tier.md](strategy/premium-tier.md) | What, if anything, is worth charging for. |
| [strategy/season-0-event.md](strategy/season-0-event.md) | The Season 0 event. |
| [strategy/reticulum-announcement.md](strategy/reticulum-announcement.md) | Announcing Reticulum support. |
| [strategy/aptos-grant-application.md](strategy/aptos-grant-application.md) | The grant application, kept for the record. |

---

## Every document

Nothing in `docs/` is missing from this page. If you add a file here, add its
row above — an index that silently omits half its directory is worse than no
index, because it reads as complete.

- `DEMO.md`, `FLASHING.md`, `RECORDING_UI.md`
- `architecture.md`, `channel-key-security.md`, `hardware.md`
- `join-the-mesh.md`, `lilyshark-capture-format.md`, `lsk-ble-contract.md`
- `meridian-gap.md`, `meshcore-participation-plan.md`, `quickstart.md`
- `related-networks.md`, `shelby-off-grid.md`, `shelby-pointer-format.md`
- `what-you-can-see.md`, `whitepaper-traceability.md`, `why-shelby.md`
- `diagrams/` — diagram sources, rendered by `scripts/build_diagrams.sh`
- `protocol/` — field receipts, witness graph, Season 0 rules
- `strategy/` — direction, offerings, announcements
- `media/` — images used above
