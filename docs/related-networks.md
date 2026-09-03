# Related networks, and why the whitepaper scopes to radio

A recurring question about the whitepaper ("The Growth Trap in Proof of
Physical Work", the PAPER tab): why does it analyze Meshtastic, MeshCore,
Reticulum, and Starlink, but not the other decentralized networks people
care about — Freenet, I2P, Yggdrasil, Veilid, and their kin? The short
answer: **the paper's unit of analysis is the physical layer**, and those
networks don't have one. This page keeps the long answer in one place, and
task PA-006 tracks folding it into a v1.1 appendix of the paper itself.

## The scope rule

Every load-bearing measurement in the paper — R = 7.36 rebroadcasts per
delivered message, reach collapse, the 6,721-node transit ceiling, the
airtime cost of a settlement transaction — is a consequence of **shared
radio spectrum**: one collision domain, finite airtime, transmit power as
a regulated resource. Proof-of-physical-work economics exist because the
physical layer is scarce and locally verifiable.

An overlay network that runs over the existing internet inherits the
internet's physical layer. Its scarce resource is trust and topology, not
airtime. That is a different economics problem — interesting, adjacent,
and out of scope for a paper about what a LoRa channel can carry.

## The networks people ask about

| Network | What it is | Layer | Why it's outside the paper's evidence |
| --- | --- | --- | --- |
| **[Freenet](https://freenet.org)** (2023 rewrite, formerly Locutus) | P2P app platform: small-world overlay routing, contracts + delegates, WebSocket app API, sub-5 MB core | Overlay over the internet | No radio, no airtime, no physical-work proof. Its introduction describes internet peer discovery end to end. What it *does* share with Reticulum is small-world/greedy routing over a keyspace — prior art the paper's routing discussion could cite. |
| **Hyphanet** (the original Freenet) | Censorship-resistant distributed datastore | Overlay | Same: storage-over-internet. Its 20-year survival without a token is, however, a data point for the paper's incentives argument. |
| **I2P / Tor** | Anonymity overlays | Overlay | Anonymity economics, not spectrum economics. |
| **Yggdrasil** | End-to-end encrypted IPv6 mesh *routing scheme* | Overlay (any IP link) | Runs over whatever links exist; it's a candidate *routing layer* for radio meshes, not a radio network. Closest to in-scope of anything here. |
| **Veilid** | P2P app framework (Cult of the Dead Cow) | Overlay | Same shape as Freenet's rewrite. |
| **NNCP / store-and-forward** | Delay-tolerant file/mail relay | Transport-agnostic | Philosophically close to the pointer/resolve design (this repo's off-grid loop is delay-tolerant); no economics layer to analyze. |
| **Nostr** | Relay-based signed-note protocol | Application over internet | Its relay economics rhyme with the paper's gateway-compensation question, but there's no physical work to verify. |

Where one of these *does* intersect the paper's argument, it's named
above: small-world routing as prior art, Hyphanet's tokenless longevity,
Yggdrasil as a routing candidate, Nostr's relay economics. That is the
shape a v1.1 appendix should take — a related-work section that says why
each is out of scope *and* what it contributes — rather than padding the
evidence sections with networks whose constraints the measurements don't
apply to.

## The interesting hybrid, honestly stated

The genuinely open question these networks raise for Lilyshark: **overlay
protocols can, in principle, run over mesh radio transports.** Reticulum
is transport-agnostic today (5 bps to gigabit); Freenet's contract model
or Yggdrasil's routing could in principle ride LoRa links the way
Reticulum does. If that happens, the paper's airtime arithmetic applies to
them instantly — a Freenet contract update competing for a 200-byte LoRa
payload budget faces exactly the R = 7.36 flood tax the paper measures.
Nothing in this repo builds toward that today; if it ever does, it enters
the [task board](../tasks/README.md) as tasks, per the same rule as
[meridian-gap.md](meridian-gap.md).
