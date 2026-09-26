# Analysis: Shelby × LoRa, modeled and measured

The quantitative case for the off-grid design in `docs/shelby-off-grid.md`,
in three parts — one simulation, one set of counterfactuals, and one set of
historical prototype indexer counters. The pinned August 15 snapshot is not
current Shelby network status or proof of Lilyshark serving revenue. See
[Shelby's network documentation](https://docs.shelby.xyz/protocol/architecture/networks)
for the current developer prototype.

| Piece | Script | Output | Kind |
| --- | --- | --- | --- |
| Scaling model | `mesh_shelby_scaling.py` | `results.md` + 3 charts | model (labeled assumptions) |
| Counterfactuals | `counterfactuals.py` | `results_counterfactuals.md` | model (failure modes) |
| Network evidence | `shelby_network_evidence.py` | `results_evidence.md` + chart | dated indexer snapshot, provenance not independently audited |

```sh
python3 analysis/mesh_shelby_scaling.py      # regenerate the scaling model
python3 analysis/counterfactuals.py          # regenerate the counterfactuals
python3 analysis/shelby_network_evidence.py  # query the configured indexer now
python3 analysis/shelby_network_evidence.py --offline   # pinned fixture (CI path)
```

Deterministic; Python 3.10+, standard library only. The evidence script
pins its snapshot to `fixtures/shelby_network_snapshot.json` so the numbers
in `results_evidence.md` are reproducible and tests never touch the network.

## What each one shows

| Scenario | Question | Answer in one line |
| --- | --- | --- |
| A. Pointer capacity | Can the mesh carry the announcements? | Thousands of pointers per day per collision domain at every architecture step — announcing was never the bottleneck. |
| B. Capture storage | What could a Lilyshark fleet write? | Output scales with assumed fleet size and capture rate; payment and retrieval still need a real service test. |
| C. The asymmetry | Why not send the payload over the air? | Under the model's managed-flood assumptions, a 200 KB blob takes ~12,600 channel-seconds; an 82-byte pointer takes 6.2 s. |
| D. Capture survival | Why copy a file off the card? | Under stated failure-rate assumptions, the model gives 57% five-year survival on one card vs 95% for the proposed replicas. A separately kept hash can check either copy. |
| E. Gateway resolution | How many gateways make off-grid work? | ~5% of nodes as gateways puts resolution under a day; a gateway is any node with connectivity, even a phone. |
| F. Historical indexer snapshot | What did the prototype indexer report on 2026-08-15? | 393k blobs / 108 GB / 48k owners / 8.09M ShelbyUSD transactions; the 275 KB average object was capture-sized. These counters are not current service guarantees. |

## Provenance and honesty

Measured/published inputs: **R = 7.36** rebroadcast factor (Meshtastic's own
discrete-event simulator, from the DePIN verification report), the
architecture ladder from the same report, 30 nodes per collision domain,
LongFast airtime from the Semtech symbol budget, the 82-byte `SHLB` pointer
from `docs/shelby-pointer-format.md`, and an August 15 prototype indexer
snapshot for the evidence page.

Everything else — captures per device per day, average capture size, fleet
sizes, card failure rates, gateway fractions — is an explicitly labeled
assumption in its script. These are models and measurements, not forecasts;
change the numbers and rerun.

Invariants and derived-value checks are tested in `test/analysis_sim/` and
run in `scripts/test_all.sh`.
