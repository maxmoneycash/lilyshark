# Analysis: Shelby × LoRa, modeled and measured

The quantitative case for the off-grid design in `docs/shelby-off-grid.md`,
in three parts — one simulation, one set of counterfactuals, and one set of
measurements from the live network.

| Piece | Script | Output | Kind |
| --- | --- | --- | --- |
| Scaling model | `mesh_shelby_scaling.py` | `results.md` + 3 charts | model (labeled assumptions) |
| Counterfactuals | `counterfactuals.py` | `results_counterfactuals.md` | model (failure modes) |
| Network evidence | `shelby_network_evidence.py` | `results_evidence.md` + chart | **measured, live network** |

```sh
python3 analysis/mesh_shelby_scaling.py      # regenerate the scaling model
python3 analysis/counterfactuals.py          # regenerate the counterfactuals
python3 analysis/shelby_network_evidence.py  # refetch live network evidence
python3 analysis/shelby_network_evidence.py --offline   # pinned fixture (CI path)
```

Deterministic; Python 3.10+, standard library only. The evidence script
pins its snapshot to `fixtures/shelby_network_snapshot.json` so the numbers
in `results_evidence.md` are reproducible and tests never touch the network.

## Refreshing the snapshot

One command re-fetches the live evidence, pins the new fixture, regenerates
`results_evidence.md` + `chart_blob_sizes.svg` with a fresh date stamp, and
republishes the docs copies the webapp serves:

```sh
scripts/refresh_evidence.sh
```

It needs network access and fails loudly without it — a refresh that read
the pinned fixture would put today's date on old numbers. Offline,
`shelby_network_evidence.py --offline` regenerates the report from the
existing snapshot, which keeps its original date stamp.

Two rules keep the evidence honest:

- **Every citation carries its date.** The snapshot date is stamped in the
  report header, the chart caption, and the fixture itself; any prose that
  quotes a headline number ("393k blobs") must quote the date it was
  measured ("as of 2026-08-15") and be updated — or at least re-dated —
  when the snapshot refreshes. An undated evidence number is a claim, not
  a measurement.
- **Shelbynet resets.** The measured network is an Early Access prototype
  chain that is wiped roughly weekly
  ([strategy memo §3](../docs/strategy/2026-q3-direction.md)), so these
  numbers are scale-of-testnet, can go *down* between snapshots, and can
  reset to near zero. A refresh that returns smaller numbers is the
  network being what we said it is, not a bug.

There is no fixed refresh interval; refresh before any surface that quotes
the numbers ships, and treat a snapshot older than the wipe cadence
(~a week) as historical rather than current.

## What each one shows

| Scenario | Question | Answer in one line |
| --- | --- | --- |
| A. Pointer capacity | Can the mesh carry the announcements? | Thousands of pointers per day per collision domain at every architecture step — announcing was never the bottleneck. |
| B. Capture storage | What does a Lilyshark fleet write to Shelby? | Linear in fleet size; serve-heavy (small immutable writes, repeated reads) — the pattern Shelby compensates. |
| C. The asymmetry | Why not send the payload over the air? | A 200 KB blob costs ~12,600 channel-seconds under today's flood; its 82-byte pointer costs 6.2 s, and falls as R falls. |
| D. Capture survival | Why not leave it on the card? | 57% odds a capture survives 5 years on microSD vs 95% replicated — and only the replica is verified on read. |
| E. Gateway resolution | How many gateways make off-grid work? | ~5% of nodes as gateways puts resolution under a day; a gateway is any node with connectivity, even a phone. |
| F. Live evidence | Is any of this real yet? | 393k blobs / 108 GB / 48k owners / 8.09M ShelbyUSD transactions on the running testnet (snapshot 2026-08-15); its average object (275 KB) is already capture-sized. |

## Provenance and honesty

Measured/published inputs: **R = 7.36** rebroadcast factor (Meshtastic's own
discrete-event simulator, from the DePIN verification report), the
architecture ladder from the same report, 30 nodes per collision domain,
LongFast airtime from the Semtech symbol budget, the 82-byte `SHLB` pointer
from `docs/shelby-pointer-format.md`, and the live indexer behind
lilyshark.vercel.app for the evidence page.

Everything else — captures per device per day, average capture size, fleet
sizes, card failure rates, gateway fractions — is an explicitly labeled
assumption in its script. These are models and measurements, not forecasts;
change the numbers and rerun.

Invariants and derived-value checks are tested in `test/analysis_sim/` and
run in `scripts/test_all.sh`.
