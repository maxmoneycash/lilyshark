# Record the complete T-Deck interface

The simulator has a presentation mode built for screen recording. It uses the
same 320x240 LVGL builders and navigation handlers as the firmware, enlarged to
a 960x720 desktop window. It does not jump between screenshots.

Simulator mode generates deterministic synthetic RF telemetry. Its fixed seed
and clock reproduce the same packet arrivals, spectrum motion, signal changes,
survey totals, protocol mix, utilization, and event markers on every run. The
values in a simulator recording are synthetic. On a T-Deck, these views use live
SX1262 captures and hardware state.

The tour shows:

- the pink Lilyshark boot frame;
- all four first-run steps;
- Home and the radio-profile picker;
- every Settings page, Help, About, and both confirmations;
- Traffic receiving new frames, packet selection, Packet Detail, and raw-byte paging;
- Protocols rolling its 60-second per-protocol and decode-health window;
- Spectrum warning, start, a continuously changing waterfall, and cancel;
- Nodes updating last-heard ages and signal histories, followed by Node Detail;
- Map and a Survey that advances while observations accumulate;
- Airtime changing its utilization, peak, noise floor, and recent bars;
- Timeline moving packet rate, median SNR, CRC failures, and event markers across one clock;
- Events adding meaningful radio, node, utilization, and survey state changes;
- packet-rate status updating across the diagnostic views;
- capture stop and restart states.

## Run the tour

```sh
./scripts/run_ui_demo.sh
```

The tour waits five seconds, follows the complete scripted route list, then
returns to the splash and repeats. The macOS window title shows the current step
and progress.
Keyboard and mouse input remain enabled, but do not use them during the scripted
pass because they change the state expected by later steps. To explore manually,
build once and launch the regular simulator instead:

```sh
uvx --with pip==25.2 --with intelhex==2.3.0 --from platformio==6.1.19 \
  platformio run -e simulator
.pio/build/simulator/program
```

## Record it on macOS

The helper can open the built-in macOS screen recorder:

```sh
./scripts/run_ui_demo.sh --record
```

When the recorder appears, select the simulator's 960x720 content area and begin
recording. Return to the terminal and press **Return** only after the recording
indicator appears. The simulator stays on the pink splash until that signal,
then starts the tour after a three-second countdown. The helper stops recording
as soon as the complete tour returns to Home and verifies that a nonempty movie
was written. The default output is:

```text
design/previews/lilyshark-ui-tour.mov
```

Choose another output path if needed:

```sh
./scripts/run_ui_demo.sh --record ~/Desktop/lilyshark-ui-tour.mov
```

The first run may require enabling **System Settings → Privacy & Security →
Screen & System Audio Recording** for the terminal application. If macOS asks,
grant access, restart the terminal, and run the command again.

The helper will not overwrite an existing movie. Move or rename the previous
file, or pass a new output path.

Before publishing the recording, watch the complete file and confirm that every
route appears, each live diagnostic view changes while it is visible, text stays
readable at 960x720, and the pass finishes on Home. Describe the footage as a
simulator demo with synthetic telemetry. Reserve “live RF capture” for footage
recorded from a physical T-Deck receiving over-the-air traffic.

For narration, record the visual pass first, then add voice-over in an editor.
This keeps the timing consistent and avoids keyboard noise.
