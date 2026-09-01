# Contributing

## Repository layout

| Path | What lives there |
| --- | --- |
| `src/`, `include/lilyshark/` | Firmware: device runtime, decoders, exports, views, Shelby pointer |
| `src/sim_main.cpp` | Device entry point and the SDL simulator in one translation unit |
| `test/` | Host tests — one directory per component, C++ and Python |
| `scripts/` | Host tooling (`lscap.py`, `shelby_pointer.py`, builds, release) |
| `docs/` | Format specifications and architecture notes |
| `samples/` | Deterministic demo captures |
| `webapp/` | Vite + React analyzer and Shelby network explorer (see `webapp/README.md`) |
| `experiments/ios6/` | Isolated 320×240 iOS 6 UI lab (not firmware) |
| `boards/`, `platformio.ini` | PlatformIO targets: `t-deck` (device) and `simulator` (host) |

## Ground rules

- **Everything testable runs on the host.** Decoders, the capture runtime,
  writers, and tooling are plain C++17 / Python 3 with no Arduino
  dependency. If a change cannot be tested on the host, that is a design
  smell, not a test gap.
- **Firmware style: no allocation, no exceptions, `noexcept` boundaries.**
  Buffers are fixed-size; results are enums. The target is a $50 handheld
  running for days.
- **C++ tests run under ASan/UBSan.** `scripts/test_all.sh` builds them with
  `-fsanitize=address,undefined`; keep them clean.
- **Wire formats are pinned by golden vectors.** `.lscap` and the `SHLB`
  pointer are shared across C++, TypeScript, and Python. The byte-exact
  vectors live in the format docs (`docs/`) and are asserted by every
  implementation. Changing a format means changing the spec, the vector,
  and all implementations in the same change.
- **Python tests use `unittest` discovery.** Add a `test/<name>/test_*.py`
  directory and one `discover` line in `scripts/test_all.sh`, next to the
  existing suites.

## Everyday commands

```sh
./scripts/test_all.sh --host-only        # host tests only (fast)
./scripts/test_all.sh                    # + simulator & t-deck builds, factory check
uvx --from platformio==6.1.19 platformio run -e simulator
uvx --from platformio==6.1.19 platformio run -e t-deck
cd webapp && npm test && npm run build   # webapp tests and production build
```

## Pull requests

- Keep changes scoped: a bug fix is not a cleanup pass.
- Match the surrounding code's conventions rather than importing new ones.
- Update the doc that describes what you changed — formats in `docs/`,
  workflow in this file, user-facing behavior in the README.
- If you touch a wire format, say so in the PR description and point at the
  updated golden vector.
- CI runs `scripts/test_all.sh` on every push; it must be green.
