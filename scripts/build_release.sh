#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "${script_dir}/.." && pwd)"
build_dir="${repo_dir}/.pio/build/t-deck"
dist_dir="${repo_dir}/dist"

cd "${repo_dir}"

# Espressif32 6.13 currently needs intelhex alongside PlatformIO's Python.
pio=(uvx --with intelhex==2.3.0 --from platformio==6.1.19 platformio)

# The factory merge is a PlatformIO post-build action. Force a clean device
# build so an up-to-date app target can never leave a stale merged image behind.
"${pio[@]}" run -e t-deck -t clean
"${pio[@]}" run -e t-deck

python3 scripts/validate_factory.py \
  --factory "${build_dir}/firmware.factory.bin" \
  --app "${build_dir}/firmware.bin" \
  --bootloader "${build_dir}/bootloader.bin" \
  --partitions "${build_dir}/partitions.bin"

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
