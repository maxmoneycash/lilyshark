---
id: PA-006
title: Related-networks appendix for whitepaper v1.1
area: paper
size: M
priority: P2
status: todo
depends_on: [PA-001]
eval:
  rubric:
  - The appendix answers "why isn't X in the paper" for the overlay networks people actually ask about (Freenet, Hyphanet, I2P, Yggdrasil, Veilid, Nostr), with the scope rule stated once.
  - Each entry names what the network contributes to the paper's argument (prior art, counterexample, candidate layer), not just why it is excluded.
  - The hybrid case — overlay protocols over mesh radio transports — is stated with the airtime arithmetic that would apply.
  - The v1.1 PDF and the pre-rendered PAPER tab pages are regenerated together, and the version/date on page 1 changes.
---

Why: Readers keep asking why decentralized-network X isn't in the paper
(Freenet was the first ask). The scope rule — the paper's unit of analysis
is the physical layer, and overlays don't have one — is now written down
in docs/related-networks.md, but a reader of the PDF never sees it.

What: Fold docs/related-networks.md into the whitepaper as a short
related-work appendix in a v1.1 revision. The paper's source is not in
this repo, so this task includes locating/recreating the source pipeline
and regenerating webapp/public/lilyshark-whitepaper.pdf plus the
webapp/public/paper/page-*.webp renders as one operation.

The auto check was removed deliberately: it tested only that
docs/related-networks.md exists, which it does for its own sake, so the
sweep reported this task as passing while the actual deliverable — a
regenerated v1.1 PDF — had not been touched. No mechanical check beats a
false green here; the rubric carries it.

Out of scope: adding overlay networks to the evidence sections — the
measurements don't apply to them, which is the appendix's whole point.
