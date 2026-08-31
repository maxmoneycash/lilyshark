#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "${script_dir}/.." && pwd)"
dist_dir="${repo_dir}/dist"
image="${dist_dir}/lilyshark-tdeck.factory.bin"
app_image="${dist_dir}/lilyshark-tdeck.bin"
checksums="${dist_dir}/SHA256SUMS"
esptool_version="4.11.0"
# Updating an already-flashed deck writes only the application at 0x10000,
# which leaves NVS alone. The factory image starts at 0x0 and carries the
# partition table, so writing it erases the radio profile, the onboarding
# state and the saved chat -- a deck that came back on a different frequency
# after an update could not hear the mesh it was part of a minute earlier.
mode="update"

usage() {
  cat <<'EOF'
Usage: scripts/flash_tdeck.sh [--factory] SERIAL_PORT
       scripts/flash_tdeck.sh [--factory] --auto

Examples:
  scripts/flash_tdeck.sh /dev/cu.usbmodem1101
  scripts/flash_tdeck.sh --auto
  scripts/flash_tdeck.sh --factory --auto     # first flash, or wipe settings

By default this updates the application only, keeping the radio profile,
onboarding state and saved chat. Use --factory for a deck that has never run
Lilyshark, or to deliberately return one to first-run setup; it erases every
saved setting.

--auto only accepts a single USB modem/ACM serial device. If zero or multiple
eligible devices are present, the script stops without flashing.
EOF
}

if [[ "${1:-}" == "--factory" ]]; then
  mode="factory"
  shift
fi

if [[ $# -ne 1 ]]; then
  usage >&2
  exit 2
fi

case "$1" in
  -h|--help)
    usage
    exit 0
    ;;
  --auto)
    shopt -s nullglob
    candidates=(/dev/cu.usbmodem* /dev/ttyACM*)
    shopt -u nullglob
    if [[ ${#candidates[@]} -ne 1 ]]; then
      echo "Automatic detection found ${#candidates[@]} eligible serial devices:" >&2
      if [[ ${#candidates[@]} -gt 0 ]]; then
        printf '  %s\n' "${candidates[@]}" >&2
      fi
      echo "Pass the T-Deck serial port explicitly." >&2
      exit 1
    fi
    port="${candidates[0]}"
    ;;
  *)
    port="$1"
    ;;
esac

if [[ "${port}" != /dev/* || ! -c "${port}" ]]; then
  echo "Serial port is not an available character device: ${port}" >&2
  exit 1
fi

if [[ ! -s "${image}" ]]; then
  echo "Factory image not found: ${image}" >&2
  echo "Build it with scripts/build_release.sh or download the release image into dist/." >&2
  exit 1
fi

if [[ ! -f "${checksums}" ]]; then
  echo "Checksum file not found: ${checksums}" >&2
  echo "Build it with scripts/build_release.sh or download the release manifest into dist/." >&2
  exit 1
fi

if [[ "${mode}" == "update" ]]; then
  image="${app_image}"
fi
image_name="$(basename "${image}")"

if [[ ! -f "${image}" ]]; then
  echo "Image not found: ${image}" >&2
  echo "Build it with scripts/build_release.sh." >&2
  exit 1
fi

expected_checksum="$(awk -v want="${image_name}" '$2 == want { print $1 }' "${checksums}")"
if [[ ! "${expected_checksum}" =~ ^[[:xdigit:]]{64}$ ]]; then
  echo "Checksum for ${image_name} is missing or invalid in ${checksums}" >&2
  exit 1
fi

if command -v shasum >/dev/null 2>&1; then
  actual_checksum="$(shasum -a 256 "${image}" | awk '{ print $1 }')"
elif command -v sha256sum >/dev/null 2>&1; then
  actual_checksum="$(sha256sum "${image}" | awk '{ print $1 }')"
else
  echo "A SHA-256 checksum utility is required" >&2
  exit 1
fi

if [[ "${actual_checksum}" != "${expected_checksum}" ]]; then
  echo "Checksum for ${image_name} does not match ${checksums}" >&2
  exit 1
fi

if ! command -v uvx >/dev/null 2>&1; then
  echo "uvx is required to run the pinned esptool release" >&2
  exit 1
fi

if [[ "${mode}" == "factory" ]]; then
  echo "Flashing ${image_name} to ${port} (factory: erases saved settings)"
  flash_offset="0x0"
else
  echo "Updating ${image_name} on ${port} (keeping saved settings)"
  flash_offset="0x10000"
fi

uvx --from "esptool==${esptool_version}" esptool.py \
  --chip esp32s3 \
  --port "${port}" \
  --baud 921600 \
  --before default_reset \
  --after hard_reset \
  write_flash "${flash_offset}" "${image}"

echo "Flash complete"
if [[ "${mode}" == "factory" ]]; then
  echo "Settings were erased; the deck will run first-time setup." >&2
  echo "Pick the same network as the rest of your mesh, or the decks will" >&2
  echo "sit on different frequencies and hear nothing." >&2
fi
