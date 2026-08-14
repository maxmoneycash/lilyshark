# Flashing Lilyshark on a LILYGO T-Deck

Lilyshark currently ships as developer-alpha firmware. The repository produces deterministic ESP32-S3 images and checksums from the same checkout, host, and pinned toolchain. GitHub Actions on `ubuntu-24.04` is the canonical release environment. The current build has not yet completed a physical T-Deck smoke test, so read the [hardware validation boundary](../README.md#project-status) before installing it.

## What you need

- A LILYGO T-Deck with an SX1262 and a suitable antenna
- A USB data cable
- [`uv`](https://docs.astral.sh/uv/) and its `uvx` command
- `git` and `curl` for the prebuilt-release path
- A writable microSD card if you want packet captures or screenshots

Flashing replaces the firmware and partition metadata at the start of the device flash. Back up data you need from the current firmware first. A project change can also make data left in other partitions inaccessible.

If this is your only T-Deck, plan the return path before flashing. Export the current firmware's settings and keep its installer or image. Returning to Meshtastic, MeshCore, or another stack requires reflashing that project.

## Install the prebuilt developer alpha

Clone the exact release tag, then download only the merged factory image and checksum manifest:

```sh
git clone --depth 1 --branch v0.1.0-alpha.4 https://github.com/maxmoneycash/lilyshark.git
cd lilyshark
mkdir -p dist
release_base='https://github.com/maxmoneycash/lilyshark/releases/download/v0.1.0-alpha.4'
curl --fail --location "${release_base}/lilyshark-tdeck.factory.bin" \
  --output dist/lilyshark-tdeck.factory.bin
curl --fail --location "${release_base}/SHA256SUMS" \
  --output dist/SHA256SUMS
```

Verify only the factory image. The manifest also lists the application image and ELF, which this install path does not need:

```sh
cd dist
awk '$2 == "lilyshark-tdeck.factory.bin" { print }' SHA256SUMS | shasum -a 256 -c -   # macOS
# awk '$2 == "lilyshark-tdeck.factory.bin" { print }' SHA256SUMS | sha256sum -c -     # Linux
cd ..
```

Continue at [Find the serial port](#find-the-serial-port), then run the guarded flash script with that exact port.

## Build from source and verify the images

From the repository root:

```sh
./scripts/build_release.sh
```

This runs PlatformIO 6.1.19 with the Intel HEX dependency required by the ESP32 factory-image merge. It writes four release files:

| File | Purpose | Flash address |
| --- | --- | ---: |
| `dist/lilyshark-tdeck.factory.bin` | Merged bootloader, partition data, boot app, and Lilyshark application | `0x0` |
| `dist/lilyshark-tdeck.bin` | Lilyshark application only | `0x10000` |
| `dist/lilyshark-tdeck.elf` | Debug symbols | Do not flash |
| `dist/SHA256SUMS` | Checksums for all three artifacts | Do not flash |

The script derives `SOURCE_DATE_EPOCH` from the checked-out Git commit so
compiler-provided date and time strings remain stable. To run the release build
twice and verify that every artifact is byte-identical:

```sh
./scripts/verify_reproducible_release.sh
```

Verify the files manually if you are moving them between machines:

```sh
cd dist
shasum -a 256 -c SHA256SUMS       # macOS
# sha256sum -c SHA256SUMS          # Linux
```

## Find the serial port

Connect the T-Deck with a USB data cable. Common port names are:

```text
macOS: /dev/cu.usbmodem1101
Linux: /dev/ttyACM0
```

List likely ports without writing anything:

```sh
ls /dev/cu.usbmodem* 2>/dev/null   # macOS
ls /dev/ttyACM* 2>/dev/null        # Linux
```

Use the exact device path you observed. Disconnect other development boards when device identity is unclear.

## Fresh install with the guarded script

The repository script checks all of these conditions before esptool writes the device:

- The argument resolves to an available character device under `/dev`
- The merged factory image exists and is non-empty
- `SHA256SUMS` contains a valid checksum for that image
- The image matches the recorded checksum
- `uvx` is available to run pinned esptool 4.11.0

Run it with the serial port:

```sh
./scripts/flash_tdeck.sh /dev/cu.usbmodem1101
```

On Linux, the same command may look like:

```sh
./scripts/flash_tdeck.sh /dev/ttyACM0
```

Automatic selection is available when exactly one eligible port exists:

```sh
./scripts/flash_tdeck.sh --auto
```

The script writes `lilyshark-tdeck.factory.bin` at `0x0` and asks esptool to reset the ESP32-S3 afterward. It does not guess when zero or multiple candidate ports exist.

## Application-only update

Use the application image only when the device already has the same Lilyshark bootloader and `default_16MB.csv` partition layout. Writing an app image over an unrelated layout can leave the device unable to boot.

```sh
uvx --from esptool==4.11.0 esptool.py \
  --chip esp32s3 \
  --port /dev/cu.usbmodem1101 \
  --baud 921600 \
  --before default_reset \
  --after hard_reset \
  write_flash 0x10000 dist/lilyshark-tdeck.bin
```

Use the merged factory image when the installed bootloader or partition table is unknown.

## Watch the first boot

Open the serial monitor at 115200 baud after flashing:

```sh
uvx --from platformio==6.1.19 platformio device monitor \
  --port /dev/cu.usbmodem1101 \
  --baud 115200
```

The startup log reports separate states for the display shell, touch controller, microSD capture, native capture, active radio profile, and SX1262 initialization. Record the complete log if startup stops or a peripheral reports an error.

With a writable microSD card inserted before boot, Lilyshark creates `/lilyshark` and starts unique `.lscap` and `.pcap` files. Press `S` after the UI appears to test display readback and BMP output. The Events screen shows the current paths or failure states.

## First hardware smoke test

This is the minimum evidence needed before calling a build hardware-validated:

1. Power-cycle the T-Deck twice and confirm the UI reaches Traffic each time.
2. Verify the status bar reports battery and the expected GPS state.
3. Move through all nine views with the trackball, keyboard arrows, number keys, and touch swipes.
4. Press `P` and confirm all five profiles reconfigure without an RF error.
5. Receive a known LoRa frame and inspect its packet detail and raw bytes.
6. Confirm a CRC-mismatch test frame appears with the correct integrity state.
7. Start, cancel, and complete a spectrum sweep. Confirm capture resumes afterward.
8. Run a 60-second survey and verify its totals against the traffic view.
9. Save a screenshot, power down cleanly, and open the BMP from the card.
10. Validate `.lscap` against the documented version 1 layout and open a supported-bandwidth `.pcap` in Wireshark.
11. Leave capture running overnight, then check resets, dropped writes, file integrity, and radio recovery.

Until this checklist has evidence from a physical unit, describe the image as developer-alpha firmware.

## If flashing fails

Keep the failure boundary clear before changing anything:

- **No serial port:** confirm the cable carries data and the operating system sees a USB device.
- **Permission denied on Linux:** fix access to the explicit `/dev/ttyACM*` device through your system's normal device-access policy.
- **Connection timeout:** retry the exact command once after reconnecting the cable. If automatic reset cannot enter the bootloader, leave USB connected and power on, hold the trackball center button, press the reset button, then release the trackball and retry.
- **Checksum failure:** rebuild with `./scripts/build_release.sh`. Do not bypass the check and flash the mismatched file.
- **Boot loop or blank display:** capture the 115200-baud serial log. Reflash the merged image at `0x0` before diagnosing the application-only image.
- **Radio error:** confirm the board variant includes the expected SX1262 and compare the logged RadioLib error with the active profile.

Do not erase unrelated serial devices or flash a port whose identity is uncertain.
