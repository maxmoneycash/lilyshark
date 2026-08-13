# Lilyshark UI simulator

A 320x240 LVGL simulator for the Lilyshark watch-only mesh diagnostics interface. The screens use deterministic sample telemetry adapted from the supplied visual references.

## Run

```sh
uvx --from platformio==6.1.19 platformio run -e simulator
.pio/build/simulator/program
```

Use the arrow keys to move between views. Number keys `1` through `9` open a view directly:

1. Live traffic
2. Spectrum waterfall
3. Node roster
4. Node detail
5. Packet detail
6. Node map
7. Survey capture
8. Events
9. Channel utilization

Pass the number on launch to open a specific screen, for example:

```sh
.pio/build/simulator/program 2
```

The ten supplied design references and their screen mapping are in [`design/references`](design/references/README.md).
