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

build_and_run profile_tuning \
  src/core/builtin_profiles.cpp \
  src/core/profile_tuning.cpp \
  test/profile_tuning/test_profile_tuning.cpp

build_and_run profile_settings \
  src/core/builtin_profiles.cpp \
  src/core/profile_tuning.cpp \
  src/core/profile_settings.cpp \
  test/profile_settings/test_profile_settings.cpp

build_and_run survey_accumulator \
  src/core/survey_accumulator.cpp \
  test/survey_accumulator/test_survey_accumulator.cpp

build_and_run packet_presentation \
  src/core/meshtastic_decoder.cpp \
  src/core/meshcore_decoder.cpp \
  src/core/reticulum_decoder.cpp \
  src/ui/packet_presentation.cpp \
  test/packet_presentation/test_packet_presentation.cpp

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

build_and_run radio_service_integration \
  -DLILYSHARK_DEVICE=1 \
  -I"${repo_dir}/test/radio_service_integration/fakes" \
  src/core/spectrum.cpp \
  src/device/radio_service.cpp \
  test/radio_service_integration/test_radio_service_integration.cpp

build_and_run radio_recovery \
  test/radio_recovery/test_radio_recovery.cpp

build_and_run monotonic_time \
  test/monotonic_time/test_monotonic_time.cpp

build_and_run radio_metadata \
  test/radio_metadata/test_radio_metadata.cpp

build_and_run touch_mapping \
  src/device/touch.cpp \
  test/touch/test_touch_mapping.cpp

build_and_run screenshot \
  src/device/screenshot.cpp \
  test/screenshot/test_screenshot.cpp

build_and_run tdeck_display_init \
  test/tdeck_display_init/test_tdeck_display_init.cpp

echo "Testing lscap_reader"
python3 -m unittest discover -s test/lscap_reader -p 'test_*.py'

echo "Testing serial_smoke"
python3 -m unittest discover -s test/serial_smoke -p 'test_*.py'

if [[ "${host_only}" == true ]]; then
  echo "All host tests passed"
  exit 0
fi

# Keep compiler-provided date/time macros stable across clean firmware builds.
# The release script uses the same commit-derived epoch. Host-only tests above
# remain runnable from a source archive without Git metadata.
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

echo "Testing the real T-Deck setup and loop under native hardware fakes"
"${pio[@]}" test -e device-shell-test -f test_device_shell

if command -v timeout >/dev/null 2>&1; then
  timeout_command="$(command -v timeout)"
elif command -v gtimeout >/dev/null 2>&1; then
  timeout_command="$(command -v gtimeout)"
else
  echo "timeout or gtimeout is required for simulator smoke tests" >&2
  exit 1
fi

echo "Testing deterministic pixels for all nine simulator screens"
render_log="${test_dir}/simulator-render.log"
if ! "${timeout_command}" 10 .pio/build/simulator/program --render-test >"${render_log}" 2>&1 || \
   ! grep -q '^Lilyshark simulator render test passed$' "${render_log}"; then
  echo "Simulator pixel-output test did not complete" >&2
  cat "${render_log}" >&2
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

echo "Testing simulator navigation and state transitions"
interaction_log="${test_dir}/simulator-interaction.log"
set +e
SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy \
  "${timeout_command}" 10 .pio/build/simulator/program --interaction-test >"${interaction_log}" 2>&1
interaction_result=$?
set -e
if [[ ${interaction_result} -ne 0 ]] || \
   ! grep -q '^Lilyshark simulator interaction test passed$' "${interaction_log}"; then
  echo "Simulator interaction test did not complete" >&2
  cat "${interaction_log}" >&2
  exit 1
fi

echo "Smoke testing continuous simulator cycling"
soak_log="${test_dir}/simulator-soak.log"
set +e
SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy \
  "${timeout_command}" 11 .pio/build/simulator/program --soak >"${soak_log}" 2>&1
soak_result=$?
set -e
if [[ ${soak_result} -ne 124 ]]; then
  echo "Continuous simulator soak exited unexpectedly (${soak_result})" >&2
  cat "${soak_log}" >&2
  exit 1
fi
if grep -Eiq 'assert|abort|sanitizer|segmentation|fatal error' "${soak_log}"; then
  echo "Continuous simulator soak logged a fatal diagnostic" >&2
  cat "${soak_log}" >&2
  exit 1
fi
if ! grep -q '^Lilyshark soak cycle 1 passed:' "${soak_log}"; then
  echo "Continuous simulator soak did not complete all nine views" >&2
  cat "${soak_log}" >&2
  exit 1
fi

echo "Building T-Deck firmware"
"${pio[@]}" run -e t-deck

python3 scripts/validate_factory.py \
  --factory .pio/build/t-deck/firmware.factory.bin \
  --app .pio/build/t-deck/firmware.bin \
  --bootloader .pio/build/t-deck/bootloader.bin \
  --partitions .pio/build/t-deck/partitions.bin \
  --boot-app .pio/build/t-deck/boot_app0.bin

echo "All tests and builds passed"
