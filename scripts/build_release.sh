#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "${script_dir}/.." && pwd)"
build_dir="${repo_dir}/.pio/build/t-deck"
dist_dir="${repo_dir}/dist"

cd "${repo_dir}"

# GCC uses SOURCE_DATE_EPOCH for __DATE__ and __TIME__. Both Arduino-ESP32 and
# RadioLib embed those macros, so leaving this unset makes an otherwise
# identical clean build produce different firmware bytes.
if [[ -z "${SOURCE_DATE_EPOCH:-}" ]]; then
  if ! SOURCE_DATE_EPOCH="$(git -C "${repo_dir}" log -1 --format=%ct 2>/dev/null)" || \
     [[ -z "${SOURCE_DATE_EPOCH}" ]]; then
    echo "SOURCE_DATE_EPOCH is required when building outside a Git checkout" >&2
    exit 1
  fi
fi
if [[ ! "${SOURCE_DATE_EPOCH}" =~ ^[0-9]+$ ]]; then
  echo "SOURCE_DATE_EPOCH must be an integer Unix timestamp" >&2
  exit 1
fi
export SOURCE_DATE_EPOCH
echo "Reproducible build epoch: ${SOURCE_DATE_EPOCH}"

# Espressif32 6.13 installs Python-backed tools during its first run, so the
# isolated PlatformIO environment needs pip as well as the factory-image helper.
pio=(uvx --with pip==25.2 --with intelhex==2.3.0 --from platformio==6.1.19 platformio)

# The factory merge is a PlatformIO post-build action. Force a clean device
# build so an up-to-date app target can never leave a stale merged image behind.
"${pio[@]}" run -e t-deck -t clean
"${pio[@]}" run -e t-deck

python3 scripts/validate_factory.py \
  --factory "${build_dir}/firmware.factory.bin" \
  --app "${build_dir}/firmware.bin" \
  --bootloader "${build_dir}/bootloader.bin" \
  --partitions "${build_dir}/partitions.bin" \
  --boot-app "${build_dir}/boot_app0.bin"

mkdir -p "${dist_dir}"
cp "${build_dir}/firmware.bin" "${dist_dir}/lilyshark-tdeck.bin"
cp "${build_dir}/firmware.factory.bin" "${dist_dir}/lilyshark-tdeck.factory.bin"
cp "${build_dir}/firmware.elf" "${dist_dir}/lilyshark-tdeck.elf"

(
  cd "${dist_dir}"
  shasum -a 256 \
    lilyshark-tdeck.bin \
    lilyshark-tdeck.factory.bin \
    lilyshark-tdeck.elf \
    > SHA256SUMS
)

echo "Release artifacts are in ${dist_dir}"
