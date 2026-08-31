# Join the mesh: flashing a new T-Deck

The exact path from a fresh clone to a T-Deck that other Lilyshark decks can
see. Written so a person — or their coding agent — can follow it without any
context from earlier sessions.

## 0. Get the right code

> [!IMPORTANT]
> Until PR #14 merges, `main` is an old alpha with a radio bug that leaves the
> device **permanently unable to receive after its first transmit**. Do not
> flash `main`, and do not use the browser flasher at lilyshark.com/flash while
> the site still serves that build. Use the branch:

```sh
git clone https://github.com/maxmoneycash/lilyshark.git
cd lilyshark
git checkout agent/lilyshark-usb-first-class   # skip once PR #14 has merged
```

## 1. Build and flash

Requirements: Python 3 with `uv` (`pip install uv`), and the T-Deck on USB.
The build bootstraps its own pinned PlatformIO — nothing global to install.

```sh
./scripts/build_release.sh                    # ~1 min; ends with "Release artifacts are in .../dist"
./scripts/flash_tdeck.sh --factory --auto     # first flash on a new deck
```

`--factory` writes the whole image and erases any saved settings, which is
what a deck that has never run Lilyshark needs. **Afterwards, update with plain
`./scripts/flash_tdeck.sh --auto`** — that writes only the application and
keeps the radio profile, so an update cannot silently move a deck onto a
different frequency from the rest of your mesh.

A fresh clone builds **without map imagery** (the baked tiles are generated,
not committed) — the map shows a georeferenced field chart instead. That is
expected; imagery comes in step 3.

## 2. First boot, and proving it works

On the device: the guided first run asks which network to inspect — choose
**MESHTASTIC**. The defaults (US LongFast, 906.875 MHz, and the published
default channel key) match every other Lilyshark deck and stock Meshtastic
nodes, so no keys or settings need to be exchanged.

Then verify from the laptop:

```sh
pip install pyserial
python3 scripts/listen_tdeck.py /dev/cu.usbmodem1101 90    # macOS; /dev/ttyACM0 on Linux
```

You should see the deck's identity (`local: !xxxxxxxx`), GPS moving from
`FINDING GPS` to `GPS ON` if it can see sky, and — if any Meshtastic node is
in range — `*** PEER` lines as it hears them. `rx` climbing with `crc=0` is
the radio working.

## 3. Map imagery for where you actually are

The map needs tiles for *your* location. The recommended path is a microSD
card — no rebuild, and it survives reflashes:

```sh
# Plan first (downloads nothing), then build. Use your own coordinates.
python3 scripts/build_map_card.py --lat 37.3230 --lon -122.0322 \
    --radius-km 2 --min-zoom 12 --max-zoom 20 --out /tmp/mapcard --dry-run
python3 scripts/build_map_card.py --lat 37.3230 --lon -122.0322 \
    --radius-km 2 --min-zoom 12 --max-zoom 20 --out /tmp/mapcard
# Copy /tmp/mapcard onto the card so the tiles live at /maps, insert, done.
```

To bake imagery into the firmware itself instead (works with no card), fetch
tiles for each zoom with `scripts/fetch_satellite_map.py`, run
`scripts/embed_map_tiles.py --centre-lat … --centre-lon …`, and rebuild.

## 4. What you will and won't see of each other

- **In LoRa range** (same neighbourhood, line of sight — hundreds of metres
  urban, kilometres open): each deck appears in the other's NODES list with
  range and signal, on the MAP once it has a GPS fix, and CHAT works both
  ways, including direct messages. This is tested hardware-to-hardware.
- **Beyond the view**: the map zooms out to a ~150 km span, and a heard node
  beyond the current view is pointed at from the screen edge with its name
  and range — you don't have to hunt for the dot.
- **Across a region** (Kenwood ↔ Cupertino is ~100 km): two handheld T-Decks
  will **not** reach each other directly — that is physics, not firmware. The
  guaranteed path is the **net relay**: keep the deck USB-linked to the
  analyzer at [lilyshark.com](https://lilyshark.com) on both ends. Every frame
  a deck hears is shared with the other analyzers in the room, shown on their
  web maps, and handed down the cable so it lands on the deck itself — node on
  the map, message in chat, chime and all — marked **NET** wherever
  provenance shows. It is on by default; the toggle lives in CONFIG. Direct
  messages work across it exactly like over the air: open the node, MESSAGE,
  send. Positions may *also* arrive over RF via the public Meshtastic mesh
  (we beacon with the standard hop limit of 3), but treat that as a bonus.
  When the decks are physically together, plain radio does everything.

## If it doesn't

- `heard nothing` from `listen_tdeck.py` with other nodes nearby: confirm the
  device shows `US LF 906.875` on Home; press `P` to reopen the profile picker.
  Two decks on different profiles are on different frequencies and will never
  hear each other, however close they are — this is the first thing to check.
- Port busy: only one program can hold the serial port — close the web
  analyzer tab or the monitor before flashing.
- Map all chart, no imagery: that is a fresh clone without tiles — step 3.
