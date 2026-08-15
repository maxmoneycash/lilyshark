# Analysis: Shelby × LoRa scaling

A parameterized simulation of how the Shelby ↔ LoRa relationship plays out
over the next several years — the quantitative backbone for the off-grid
design in `docs/shelby-off-grid.md`.

```sh
python3 analysis/mesh_shelby_scaling.py
```

Regenerates [`results.md`](results.md) and the three SVG charts in this
directory. Deterministic; Python 3.10+, standard library only.

## What it models

| Scenario | Question | Answer in one line |
| --- | --- | --- |
| A. Pointer capacity | Can the mesh carry the announcements? | Thousands of pointers per day per collision domain at every architecture step — announcing was never the bottleneck. |
| B. Capture storage | What does a Lilyshark fleet write to Shelby? | Linear in fleet size; serve-heavy (small immutable writes, repeated reads) — the pattern Shelby compensates. |
| C. The asymmetry | Why not send the payload over the air? | A 200 KB blob costs ~12,600 channel-seconds under today's flood; its 82-byte pointer costs 6.2 s, and falls as R falls. |

## Provenance and honesty

Measured/published inputs: **R = 7.36** rebroadcast factor (Meshtastic's own
discrete-event simulator, from the DePIN verification report), the
architecture ladder from the same report, 30 nodes per collision domain,
LongFast airtime from the Semtech symbol budget, and the 82-byte `SHLB`
pointer from `docs/shelby-pointer-format.md`.

Everything else — captures per device per day, average capture size, fleet
sizes, serves per blob — is an explicitly labeled assumption at the top of
`mesh_shelby_scaling.py`. This is a model, not a forecast; change the
numbers and rerun.

Invariants (airtime monotonicity, ladder ordering, linear fleet scaling,
pointer-beats-payload by orders of magnitude) are tested in
`test/analysis_sim/` and run in `scripts/test_all.sh`.
