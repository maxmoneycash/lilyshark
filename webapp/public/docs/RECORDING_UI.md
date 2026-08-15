# Record the complete T-Deck interface

The simulator has a presentation mode for repeatable screen recordings. It runs
the firmware's 320x240 LVGL screen builders and navigation handlers in a 960x720
desktop window. Each pass follows 87 scripted UI states through the real input
handlers instead of swapping among saved screenshots.

Simulator mode generates deterministic synthetic RF telemetry. A fixed seed and
clock reproduce the packet arrivals, spectrum movement, signal changes, survey
totals, protocol mix, airtime, and event markers on every run. Label published
footage as a simulator demo with synthetic telemetry. A physical T-Deck replaces
these values with SX1262 captures and device state.

## What the tour covers

The product-shell portion shows:

- the pink Lilyshark boot frame;
- all six first-run stages: welcome, capabilities, mesh network, radio profile,
  field controls, and device readiness;
- Home and the radio-profile picker;
- Capture & Storage, including stop and restart states;
- Device Status and Display & Input changes;
- Help, About, the spectrum ownership warning, and the guarded setup reset.

The analyzer portion shows:

- Traffic receiving packets and opening a selected frame;
- all five Packet Inspector tabs: summary, RF metadata, decoder analysis, paged
  hex bytes, and current writer state;
- Protocols, MeshCore protocol detail, and the Traffic Filter handoff;
- a deep-band spectrum scan that is cancelled, followed by a completed fast
  narrow scan whose measured power heatmap grows across completed bins;
- Nodes with changing last-heard ages and signal histories, then Node Detail;
- the explicitly simulated local GPS view on Map;
- a running Survey with accumulating observations;
- Airtime with changing observed utilization, packet rate, CRC rate, and recent
  per-packet airtime bars;
- Timeline with packet rate, signal trend, CRC failures, event markers, and a
  Meshtastic filter;
- Events receiving state changes and opening two full event messages;
- the final return to Home.

Spectrum scans pause packet reception while the radio sweeps. Traffic filters
change what the screen lists, while capture files keep every received frame.

## Check the tour without opening a window

Run the recording preflight by itself:

```sh
./scripts/run_ui_demo.sh --check
```

The command builds the simulator and stops unless all three gates pass:

1. Every analyzer, shell, and inspector framebuffer matches its checked-in
   render expectation.
2. Every live analyzer included in the motion test changes visibly.
3. A headless fast pass verifies the expected route and tool state at every one
   of the 87 tour steps, including the first and last.

This is the quickest check after changing a screen or the scripted route.

## Rehearse the visible tour

```sh
./scripts/run_ui_demo.sh
```

After the same preflight, the simulator holds its splash for five seconds and
runs the full route. A normal pass takes about two minutes and thirty-five
seconds, then returns to the splash and repeats. The window title shows the
current step and `NN/87` progress.

Leave the keyboard and mouse alone during a scripted pass. Manual input changes
the state expected by later steps. For free exploration, build once and launch
the regular simulator:

```sh
uvx --with pip==25.2 --with intelhex==2.3.0 --from platformio==6.1.19 \
  platformio run -e simulator
.pio/build/simulator/program
```

Arrow keys or the T-Deck trackball move the selection. Enter or a trackball
press opens it. Escape or Backspace goes back. The main shortcuts are `M` or
`0` for Home, `P` for Radio Profiles, `?` for Help, `1` through `7` for the
primary analyzers, `8` for Settings, `9` for Protocols, and `T` for Timeline.
Press `X` on Traffic to open its filter. Mouse clicks work in the simulator.

## Record one pass on macOS

```sh
./scripts/run_ui_demo.sh --record
```

The helper runs the full preflight, opens a dedicated simulator window, and
keeps it frozen on the pink splash. A small macOS helper identifies the one
on-screen window owned by that simulator process and confirms that it is at
least 960x720. On macOS 14 or newer, a second helper records that exact window
with ScreenCaptureKit's desktop-independent window capture. It keeps native
Retina resolution even if another app briefly covers the simulator or the user
changes Spaces. The script checks that the recorder remains active and only
then releases the simulator's synchronized start signal. No region selection
or Return key is needed.

The tour begins after a three-second splash lead. The helper verifies the final
Home state, keeps macOS awake for the whole pass, then lets the recorder finish
its bounded 160-second capture so the MOV is finalized normally with only a
brief Home outro. The simulator locks its content area at 960x720, hides its
cursor, and fails if its geometry changes. The script validates the movie before
moving it to the requested output path. Do not close the simulator before the
command finishes; covering it or changing Spaces is safe in automatic mode.

If macOS hides the window, the Swift compiler is unavailable, or automatic
recording exits before the tour starts, an interactive terminal falls back to
the manual region selector while the simulator is still frozen. You can request
that path directly:

```sh
./scripts/run_ui_demo.sh --record-manual ~/Desktop/lilyshark-ui-tour.mov
```

For manual selection, capture at least the simulator's 960x720 content area,
start recording, then return to the terminal and press Return. The same start
signal, route checks, completion signal, and movie validation still apply.

The default movie stays in PlatformIO's ignored local build directory:

```text
.pio/recordings/lilyshark-ui-tour.mov
```

Choose a different output path when you want a file ready for an editor:

```sh
./scripts/run_ui_demo.sh --record ~/Desktop/lilyshark-ui-tour.mov
```

The helper refuses to overwrite an existing file. It verifies the simulator's
recording-ready acknowledgement, synchronized start, the expected state at all
87 steps, and the final completion marker. The resulting file must be a video
larger than 1 MB, between 140 and 190 seconds long, and at least 960x720. The
upper bound rejects a frozen tail. Validation uses `ffprobe` when available and
falls back to macOS file metadata. When `ffmpeg` is installed, it also rejects
any display blackout lasting one second or longer.

Automatic recording requires macOS 14 or newer, the Swift compiler, and may
require **System Settings > Privacy & Security > Screen & System Audio
Recording** access for the terminal application. Grant access, restart that
terminal application, and run the command again. Automatic attempts use a
temporary movie until validation succeeds. A cancelled manual attempt can leave
a partial file at the requested output path; move or remove it before retrying.

Watch the finished movie before publishing it. Confirm that text remains
readable, live graphs move while visible, both spectrum scan modes appear, and
the final frame is Home. Use “live RF capture” only for footage recorded from a
physical T-Deck receiving over-the-air traffic.

Record narration afterward in an editor. The scripted visual pass keeps the
timing steady and avoids keyboard noise.
