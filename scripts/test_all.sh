#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "${script_dir}/.." && pwd)"
platformio_version="6.1.19"
intelhex_version="2.3.0"
pip_version="25.2"
cxx="${CXX:-c++}"

usage() {
  cat <<'EOF'
Usage: scripts/test_all.sh [--host-only]

Runs the sanitizer-backed host test suite. With no option, it also builds the
simulator and T-Deck firmware using the pinned PlatformIO toolchain.
EOF
}

host_only=false
case "${1:-}" in
  "") ;;
  --host-only) host_only=true ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

if [[ $# -gt 1 ]]; then
  usage >&2
  exit 2
fi

if ! command -v "${cxx}" >/dev/null 2>&1; then
  echo "C++ compiler not found: ${cxx}" >&2
  exit 1
fi

test_dir="$(mktemp -d "${TMPDIR:-/tmp}/lilyshark-tests.XXXXXX")"
cleanup() {
  rm -rf -- "${test_dir}"
}
trap cleanup EXIT

common_flags=(
  -std=c++17
  -O1
  -g
  -Wall
  -Wextra
  -Wpedantic
  -Werror
  -fno-omit-frame-pointer
  -fsanitize=address,undefined
  -fno-sanitize-recover=all
  -I"${repo_dir}/include"
)

build_and_run() {
  local name="$1"
  shift
  local binary="${test_dir}/${name}"

  echo "Testing ${name}"
  "${cxx}" "${common_flags[@]}" "$@" -o "${binary}"
  "${binary}"
}

cd "${repo_dir}"

build_and_run core_runtime \
  src/core/decoder_registry.cpp \
  src/core/meshtastic_decoder.cpp \
  src/core/meshcore_decoder.cpp \
  src/core/reticulum_decoder.cpp \
  test/core_runtime/test_core_runtime.cpp

build_and_run decoder_stress \
  src/core/decoder_registry.cpp \
  src/core/meshtastic_decoder.cpp \
  src/core/meshcore_decoder.cpp \
  src/core/reticulum_decoder.cpp \
  test/decoder_stress/test_decoder_stress.cpp

build_and_run battery_model \
  src/device/battery_model.cpp \
  test/hardware_status/test_battery_model.cpp

build_and_run lilyshark_capture \
  src/export/lilyshark_capture.cpp \
  test/lilyshark_capture/test_lilyshark_capture.cpp

build_and_run pcap_export \
  src/export/pcap_loratap.cpp \
  test/pcap_export/test_pcap_export.cpp

build_and_run spectrum \
  src/core/spectrum.cpp \
  test/spectrum/test_spectrum.cpp

build_and_run touch_mapping \
  src/device/touch.cpp \
  test/touch/test_touch_mapping.cpp

build_and_run screenshot \
  src/device/screenshot.cpp \
  test/screenshot/test_screenshot.cpp

if [[ "${host_only}" == true ]]; then
  echo "All host tests passed"
  exit 0
fi

if ! command -v uvx >/dev/null 2>&1; then
  echo "uvx is required to run the pinned PlatformIO toolchain" >&2
  exit 1
fi

pio=(
  uvx
  --with "pip==${pip_version}"
  --with "intelhex==${intelhex_version}"
  --from "platformio==${platformio_version}"
  platformio
)

echo "Building simulator"
"${pio[@]}" run -e simulator

if command -v timeout >/dev/null 2>&1; then
  timeout_command="$(command -v timeout)"
elif command -v gtimeout >/dev/null 2>&1; then
  timeout_command="$(command -v gtimeout)"
else
  echo "timeout or gtimeout is required for simulator smoke tests" >&2
  exit 1
fi

echo "Smoke testing all nine simulator screens"
for screen in 1 2 3 4 5 6 7 8 9; do
  log="${test_dir}/simulator-screen-${screen}.log"
  set +e
  SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy \
    "${timeout_command}" 1 .pio/build/simulator/program "${screen}" >"${log}" 2>&1
  result=$?
  set -e
  if [[ ${result} -ne 124 ]]; then
    echo "Simulator screen ${screen} exited unexpectedly (${result})" >&2
    cat "${log}" >&2
    exit 1
  fi
  if grep -Eiq 'assert|abort|sanitizer|segmentation|fatal error' "${log}"; then
    echo "Simulator screen ${screen} logged a fatal diagnostic" >&2
    cat "${log}" >&2
    exit 1
  fi
done

echo "Building T-Deck firmware"
"${pio[@]}" run -e t-deck

python3 scripts/validate_factory.py \
  --factory .pio/build/t-deck/firmware.factory.bin \
  --app .pio/build/t-deck/firmware.bin \
  --bootloader .pio/build/t-deck/bootloader.bin \
  --partitions .pio/build/t-deck/partitions.bin

echo "All tests and builds passed"
