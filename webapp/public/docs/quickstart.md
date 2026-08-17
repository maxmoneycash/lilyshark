# Quickstart — evaluate Lilyshark in ten minutes

No radio hardware required for any of this.

## 1. Open the web analyzer (1 minute)

Go to the deployed app and open the **TRAFFIC** screen. Press **Sample** —
the bundled capture loads: 24 frames of US LongFast traffic (906.875 MHz,
SF11/BW250), one CRC failure, one truncated frame — and frame **9 marked
◆ SHLB**. Select it: the detail panel decodes the Shelby off-grid pointer
(commitment, owner, size, expiry) beside the hex dump.

The same screen fetches captures straight from Shelby by blob name, the
SHELBY screen indexes the live network — blobs, storage, providers, and the
ShelbyUSD economy — and the CHAT/NODES/MAP screens drive a real radio over
USB or Bluetooth if you have one.

## 2. Scan the same capture from the CLI (1 minute)

```sh
python3 scripts/lscap.py validate samples/sample-mesh-traffic.lscap
python3 scripts/shelby_pointer.py scan samples/sample-mesh-traffic.lscap
```

The scanner reports exactly one pointer, at sequence 9, payload offset 16.

## 3. Emit and verify your own pointer (2 minutes)

```sh
echo "hello from the mesh" > blob.bin
python3 scripts/shelby_pointer.py emit blob.bin \
  --owner 0x0000000000000000000000000000000000000000000000000000000000000001
python3 scripts/shelby_pointer.py verify blob.shlb blob.bin
```

`verify` recomputes the commitment and checks size and expiry — the check a
gateway runs before trusting bytes it resolved. Corrupt `blob.bin` and run
it again to see the rejection.

## 4. Run the test suite (3 minutes)

```sh
./scripts/test_all.sh --host-only   # add nothing for firmware builds too
```

C++ tests run under AddressSanitizer and UndefinedBehaviorSanitizer; Python
suites cover the capture reader and the pointer tooling. CI runs the same
script on every push.

## 5. Drive the firmware UI without a device (3 minutes)

```sh
uvx --from platformio==6.1.19 platformio run -e simulator
.pio/build/simulator/program
```

The full product shell and analyzer run with deterministic moving synthetic RF
telemetry. `--render-test` compares every screen's framebuffer against checked-in
expectations, `--animation-test` proves the live data regions move, and
`scripts/run_ui_demo.sh` drives the complete recording tour.

## Where to go next

| You want | Read |
| --- | --- |
| The whole system on one page | `docs/architecture.md` |
| The off-grid design and gateway workflow | `docs/shelby-off-grid.md` |
| The 82-byte pointer wire format | `docs/shelby-pointer-format.md` |
| The `.lscap` capture format | `docs/lilyshark-capture-format.md` |
| Flash a real T-Deck | `docs/FLASHING.md` |
| Hack on the code | `CONTRIBUTING.md` |
