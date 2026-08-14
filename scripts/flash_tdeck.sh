#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "${script_dir}/.." && pwd)"
dist_dir="${repo_dir}/dist"
image="${dist_dir}/lilyshark-tdeck.factory.bin"
checksums="${dist_dir}/SHA256SUMS"
esptool_version="4.11.0"

usage() {
  cat <<'EOF'
Usage: scripts/flash_tdeck.sh SERIAL_PORT
       scripts/flash_tdeck.sh --auto

Examples:
  scripts/flash_tdeck.sh /dev/cu.usbmodem1101
  scripts/flash_tdeck.sh /dev/ttyACM0

--auto only accepts a single USB modem/ACM serial device. If zero or multiple
eligible devices are present, the script stops without flashing.
EOF
}

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
  echo "Run scripts/build_release.sh first." >&2
  exit 1
fi

if [[ ! -f "${checksums}" ]]; then
  echo "Checksum file not found: ${checksums}" >&2
  echo "Run scripts/build_release.sh first." >&2
  exit 1
fi

expected_checksum="$(awk '$2 == "lilyshark-tdeck.factory.bin" { print $1 }' "${checksums}")"
if [[ ! "${expected_checksum}" =~ ^[[:xdigit:]]{64}$ ]]; then
  echo "Factory image checksum is missing or invalid in ${checksums}" >&2
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
  echo "Factory image checksum does not match ${checksums}" >&2
  exit 1
fi

if ! command -v uvx >/dev/null 2>&1; then
  echo "uvx is required to run the pinned esptool release" >&2
  exit 1
fi

echo "Flashing ${image} to ${port}"
uvx --from "esptool==${esptool_version}" esptool.py \
  --chip esp32s3 \
  --port "${port}" \
  --baud 921600 \
  --before default_reset \
  --after hard_reset \
  write_flash 0x0 "${image}"

echo "Flash complete"
