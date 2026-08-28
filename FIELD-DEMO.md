# Two T-Decks in the field

Everything below was verified on hardware except the last step, which needs
both devices flashed at once.

## Flash both devices

The firmware in `dist/` is current. With one device on USB:

```sh
./scripts/preflight_tdeck.sh     # 6 checks, expects exactly one serial device
./scripts/flash_tdeck.sh --auto
```

Then swap and repeat. **Both** need this image: an older build cannot receive
(see "the radio was deaf" below), so one flashed device and one stale device
gives you traffic in one direction only, which looks like nothing working.

Confirm a device after flashing:

```sh
python3 - <<'EOF'
import serial, time, json
s = serial.Serial("/dev/cu.usbmodem101", 115200, timeout=1)
time.sleep(0.4); s.write(b"LSK HELLO\n")
for _ in range(60):
    line = s.readline().decode("utf-8", "replace").strip()
    if line.startswith("LSK "):
        print(line[:120])
EOF
```

`LSK ID` gives the node number. `LSK T` repeats every two seconds with GPS
state, satellites, position, battery and radio profile.

## What to expect, and when

| | |
| --- | --- |
| GPS fix | outdoors, under two minutes from cold; indoors it may never lock |
| Peer in NODES | within ~90 s (NodeInfo beacon) |
| Peer on MAP | within ~60 s of both having a fix (position beacon) |

Neither beacon needs a laptop attached. That was the bug described below.

## Driving it

- `4` opens MAP. `+` and `-` zoom, z12 to z20. At z20 two people standing five
  metres apart are about 43 px apart, which is what makes them separately
  tappable.
- Tap a dot for the node card: name, node number, range and bearing, their
  coordinates, then **MESSAGE** or **TELEMETRY**. Tapping empty map dismisses it.
- `C` opens CHAT. Type and press Enter. `Tab` cycles peers, LEFT returns to MAP.
- An arriving message takes over the status bar for twelve seconds on whatever
  screen you are looking at.
- NODES lists this device pinned at the top, then peers.

## Map imagery

The device reads tiles from `/maps` on a microSD card, and falls back to tiles
baked into flash. The baked set covers 38.400, -122.580 at zoom 12 to 20. For
somewhere else:

```sh
python3 scripts/fetch_satellite_map.py --lat LAT --lon LON --zoom 15 \
    --style satellite --out assets/maps/sat_LAT_LON_z15.rgb565
python3 scripts/embed_map_tiles.py --lat CELL_LAT --lon CELL_LON \
    --out src/assets/map_tiles_baked.cpp
```

Cell coordinates are latitude and longitude rounded to three decimals. The
generated file is ~8 MB and is not committed; weak defaults keep the firmware
building without it, in which case the map draws its field chart instead.

A tile spans over a kilometre at z15 but only about 37 m at z20, so bake the
place you will actually stand.

## The radio was deaf

Worth knowing, because it explains why nothing worked before.

`transmit()` clears the DIO1 interrupt before keying up, and `resumeReceive()`
only called `startReceive()`. The handler was re-attached solely inside
`configure()`. So after the first transmit the radio reported that it was
receiving while the interrupt that delivers packets was gone — and the device
announces itself on the mesh during boot. It went deaf before it had ever
heard anything, and its receive counter stayed at zero forever.

`test/radio_service_integration` now transmits, raises the interrupt the way
the radio would, and requires the frame to reach the capture sink.

## Taking the map somewhere new

The firmware carries imagery for one baked location. Away from it the map falls
back to a drawn field chart. A microSD card fixes that for good:

```sh
# See what it would cost before downloading anything.
python3 scripts/build_map_card.py --lat 38.3996 --lon -122.5795 \
    --radius-km 1 --min-zoom 12 --max-zoom 20 --out /tmp/mapcard --dry-run

# Build it, then copy the directory to the card root as /maps.
python3 scripts/build_map_card.py --lat 38.3996 --lon -122.5795 \
    --radius-km 1 --min-zoom 12 --max-zoom 20 --out /tmp/mapcard
```

Card tiles sit on the Web Mercator pixel grid — tile `(i, j)` at zoom `z` is
exactly the world pixels `[i*320, i*320+320)` by `[j*204, j*204+204)` — so they
meet edge to edge with no gaps. Deep zooms cover less ground than shallow ones
for the same tile budget; the tool prints the actual coverage per zoom and says
so out loud when `--max-tiles` trimmed it.

The card outranks the baked tiles wherever it has a tile for the view.

## Map controls

- **Trackball**: roll to pan, click to snap back to where you are standing.
- **`+` / `-`**: zoom. Also the on-screen chips.
- **`I` / `D` / `G`**: satellite imagery, dark map, drawn chart.
- **Drag**: pans, same as the trackball, but a fingertip covers about 40 px of a
  320 px panel — at deep zoom that is most of the gap between two operators
  standing together, so the trackball is the more precise of the two.

## Alerts

- A message arriving raises a banner across the status bar for twelve seconds
  **and** plays a rising two-tone through the speaker.
- A node heard for the first time announces `<NAME> IS ON THE MESH` and plays
  two short low blips — quieter than a message, because it is not addressed to
  you.
- The nodes list colours the `LAST` column by how long ago the node was heard:
  green within five minutes, amber out to thirty, red beyond. That is the
  question the list exists to answer.
- Conversations are saved to NVS and survive a power cycle. The write is
  debounced by fifteen seconds so a busy channel does not chew through flash.
