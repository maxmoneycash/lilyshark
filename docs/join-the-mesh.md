# Set up a T-Deck for Lilyshark

This is a developer-alpha setup path. The current source builds for T-Deck
Plus, but a fresh unit still needs a physical smoke test. See the
[hardware status](hardware.md) before relying on capture files or a scan.

## Build and flash

Build from the current `main` source. Check the release page and image date
separately before using a hosted flasher; a hosted image may lag the source.

```sh
git clone https://github.com/maxmoneycash/lilyshark.git
cd lilyshark
./scripts/build_release.sh
./scripts/flash_tdeck.sh --factory --auto   # first flash; erases saved settings
```

The scripts require Python 3 and `uv` and bootstrap the pinned PlatformIO
toolchain. After the first flash, use `./scripts/flash_tdeck.sh --auto` to
write only the application and preserve saved radio settings. The auto
selector stops unless it finds exactly one eligible USB serial device. A
fresh build has a georeferenced chart but no locally baked map imagery.

## Select and verify the radio profile

On first run, choose the network and radio profile used by the peers you intend
to test. `MESHTASTIC US LF` is the included US LongFast starting profile;
`MESHTASTIC BAY MF` is an included Bay Area MediumFast starting profile. Check
the actual region, channel, frequency, bandwidth, spreading factor, coding
rate, and channel key on both ends. A preset name alone does not establish
compatibility with a local community's current configuration.

With the deck attached over USB, save a bounded startup log and run the smoke
script:

```sh
python3 scripts/smoke_tdeck.py --auto --seconds 90 --log tdeck-startup.log
python3 scripts/listen_tdeck.py /dev/cu.usbmodem1101 90
```

Replace the serial path with the port on your computer; install `pyserial`
if the listener requests it. Check for the deck's identity, radio
initialization, and a GPS fix where sky view permits. A rising receive count
or peer line is evidence only for frames heard under the selected settings.
Save the exact image revision, card, antenna, and profile with the log.

## Optional map imagery

The map can read imagery from a microSD card. Plan and fetch tiles for your
own location, then copy the resulting `maps` directory to the card:

```sh
python3 scripts/build_map_card.py --lat 37.3230 --lon -122.0322 \
  --radius-km 2 --min-zoom 12 --max-zoom 20 --out /tmp/mapcard --dry-run
python3 scripts/build_map_card.py --lat 37.3230 --lon -122.0322 \
  --radius-km 2 --min-zoom 12 --max-zoom 20 --out /tmp/mapcard
```

This path needs a physical card check; firmware build success does not prove
that the deck mounted or wrote the card. See [flashing](FLASHING.md) for the
full flash procedure and [hardware](hardware.md) for pending tests.

## Pair a phone and use the analyzer

The firmware includes Meshtastic's client Bluetooth service and a message
bridge. Pair the official Meshtastic app with `Lilyshark <shortname>`, then
verify a live receive and send with a second radio. Settings written from the
phone are not applied yet; use the deck's settings screen.

Open [lilyshark.com](https://lilyshark.com) in a computer browser with Web
Serial and choose **LILYSHARK T-DECK · USB** for the analyzer link. Its
SNIFFER view inspects frames; TRAFFIC opens and compares captures; SPECTRUM
shows scans from the deck. The separate **LSK analyzer Bluetooth** service
exists in source, but the browser option remains disabled until a physical BLE
session and a released image have been verified. Chromium's Meshtastic and
MeshCore Bluetooth client paths are separate protocol connections.

The site installs as an offline app. Once loaded, local capture inspection
works without internet. Remote capture fetching, maps, and regional feeds
need a network connection. On iPhone, use the native app in `ios/` for
supported device connectivity; Safari has no Web Bluetooth or Web Serial.

## What a connection proves

Two T-Deck Plus units have exchanged and decoded live Meshtastic traffic and
direct messages. Range depends on placement, antenna, obstruction, and RF
settings. A GPS position is needed for a map location; a received identity
alone does not provide one. The spectrum scan and microSD capture paths still
need physical validation.

The internet relay is an optional, separately connected path, **off by
default** in CONFIG. It is not proof of LoRa reachability. Delivery depends
on both clients, the relay, and their live connections. Relayed data must
retain its **NET** provenance in the interface. Test an end-to-end
conversation before relying on it; there is no delivery guarantee.

If nothing is heard, first compare the configured radio profiles and keys.
If a serial port is busy, close its analyzer or monitor tab before flashing.
A chart without satellite imagery is expected until tiles are installed.
