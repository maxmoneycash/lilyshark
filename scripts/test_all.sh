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
  src/core/meshtastic_payload.cpp \
  src/crypto/aes128.cpp \
  src/core/meshcore_decoder.cpp \
  src/core/reticulum_decoder.cpp \
  test/core_runtime/test_core_runtime.cpp

build_and_run decoder_stress \
  src/core/decoder_registry.cpp \
  src/core/meshtastic_decoder.cpp \
  src/core/meshtastic_payload.cpp \
  src/crypto/aes128.cpp \
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

build_and_run app_settings \
  src/core/app_settings.cpp \
  test/app_settings/test_app_settings.cpp

build_and_run app_shell \
  src/ui/app_shell.cpp \
  test/app_shell/test_app_shell.cpp

build_and_run runtime_event_history \
  src/core/runtime_event_history.cpp \
  test/runtime_event_history/test_runtime_event_history.cpp

build_and_run rolling_diagnostics \
  src/core/rolling_diagnostics.cpp \
  test/rolling_diagnostics/test_rolling_diagnostics.cpp

build_and_run live_telemetry \
  -DLILYSHARK_LIVE_TELEMETRY_DECODER_CROSSCHECK=1 \
  src/simulator/live_telemetry.cpp \
  src/core/meshtastic_decoder.cpp \
  src/core/meshtastic_payload.cpp \
  src/crypto/aes128.cpp \
  src/core/meshcore_decoder.cpp \
  src/core/reticulum_decoder.cpp \
  test/live_telemetry/test_live_telemetry.cpp

build_and_run diagnostic_tools \
  src/core/diagnostic_tools.cpp \
  test/diagnostic_tools/test_diagnostic_tools.cpp

build_and_run survey_accumulator \
  src/core/survey_accumulator.cpp \
  test/survey_accumulator/test_survey_accumulator.cpp

build_and_run packet_presentation \
  src/core/meshtastic_decoder.cpp \
  src/core/meshtastic_payload.cpp \
  src/crypto/aes128.cpp \
  src/core/meshcore_decoder.cpp \
  src/core/reticulum_decoder.cpp \
  src/ui/packet_presentation.cpp \
  test/packet_presentation/test_packet_presentation.cpp

build_and_run battery_model \
  src/device/battery_model.cpp \
  test/hardware_status/test_battery_model.cpp

build_and_run gps_session \
  -DLILYSHARK_DEVICE=1 \
  -I"${repo_dir}/test/hardware_status/fakes" \
  src/device/battery_model.cpp \
  src/device/hardware_status.cpp \
  test/hardware_status/test_gps_session.cpp

build_and_run lilyshark_capture \
  src/export/lilyshark_capture.cpp \
  test/lilyshark_capture/test_lilyshark_capture.cpp

build_and_run pcap_export \
  src/export/pcap_loratap.cpp \
  test/pcap_export/test_pcap_export.cpp

build_and_run simulate_source \
  src/device/simulate_source.cpp \
  src/shelby/shelby_pointer.cpp \
  test/simulate_source/test_simulate_source.cpp

build_and_run meshtastic_payload \
  src/crypto/aes128.cpp \
  src/core/meshtastic_payload.cpp \
  src/core/meshtastic_encode.cpp \
  test/meshtastic_payload/test_meshtastic_payload.cpp

build_and_run shelby_pointer \
  src/shelby/shelby_pointer.cpp \
  src/shelby/shelby_pointer_decoder.cpp \
  test/shelby_pointer/test_shelby_pointer.cpp

build_and_run shelby_registry \
  src/core/decoder_registry.cpp \
  src/core/meshtastic_decoder.cpp \
  src/core/meshtastic_payload.cpp \
  src/crypto/aes128.cpp \
  src/core/meshcore_decoder.cpp \
  src/core/reticulum_decoder.cpp \
  src/shelby/shelby_pointer.cpp \
  src/shelby/shelby_pointer_decoder.cpp \
  test/shelby_registry/test_shelby_registry.cpp

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

echo "Testing shelby_pointer_py"
python3 -m unittest discover -s test/shelby_pointer_py -p 'test_*.py'

echo "Testing analysis_sim"
python3 -m unittest discover -s test/analysis_sim -p 'test_*.py'

echo "Testing docs_sync"
python3 -m unittest discover -s test/docs_sync -p 'test_*.py'

echo "Testing serial_smoke"
python3 -m unittest discover -s test/serial_smoke -p 'test_*.py'

echo "Testing logo_asset"
python3 -m unittest discover -s test/logo_asset -p 'test_*.py'

echo "Testing tdeck_preflight"
python3 -m unittest discover -s test/tdeck_preflight -p 'test_*.py'

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

echo "Testing deterministic pixels for all analyzer and shell screens"
render_log="${test_dir}/simulator-render.log"
if ! "${timeout_command}" 10 .pio/build/simulator/program --render-test >"${render_log}" 2>&1 || \
   ! grep -q '^Lilyshark simulator render test passed$' "${render_log}"; then
  echo "Simulator pixel-output test did not complete" >&2
  cat "${render_log}" >&2
  exit 1
fi

echo "Testing visible motion across every live analyzer screen"
animation_log="${test_dir}/simulator-animation.log"
if ! "${timeout_command}" 10 .pio/build/simulator/program --animation-test >"${animation_log}" 2>&1 || \
   ! grep -q '^Lilyshark simulator animation test passed$' "${animation_log}"; then
  echo "Simulator animation test did not complete" >&2
  cat "${animation_log}" >&2
  exit 1
fi

echo "Testing deterministic README animation frames"
readme_frame_dir="${test_dir}/readme-live-frames"
mkdir -p "${readme_frame_dir}"
readme_frame_log="${test_dir}/readme-live-frames.log"
if ! "${timeout_command}" 10 \
     .pio/build/simulator/program --readme-frames "${readme_frame_dir}" \
     >"${readme_frame_log}" 2>&1 || \
   ! grep -q '^Lilyshark README live frames written: 118$' "${readme_frame_log}" || \
   [[ "$(find "${readme_frame_dir}" -type f -name 'live-*.ppm' | wc -l | tr -d ' ')" -ne 118 ]]; then
  echo "Simulator README animation frames were incomplete" >&2
  cat "${readme_frame_log}" >&2
  exit 1
fi

echo "Smoke testing all thirteen simulator screens"
for screen in $(seq 1 13); do
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

echo "Testing the complete screen-recording tour"
demo_log="${test_dir}/simulator-demo.log"
if ! SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy \
     LILYSHARK_DEMO_LEAD_MS=0 LILYSHARK_DEMO_STEP_MS=5 LILYSHARK_DEMO_ONCE=1 \
     "${timeout_command}" 10 .pio/build/simulator/program --demo >"${demo_log}" 2>&1 || \
   ! grep -q '^Lilyshark UI tour test passed$' "${demo_log}" || \
   [[ "$(grep -c '^UI tour [0-9][0-9]/[0-9][0-9]:' "${demo_log}")" -ne 87 ]]; then
  echo "Simulator screen-recording tour did not complete every step" >&2
  cat "${demo_log}" >&2
  exit 1
fi

echo "Testing screen-recording start and completion synchronization"
demo_signal_dir="${test_dir}/simulator-demo-signals"
mkdir -p "${demo_signal_dir}"
demo_start_signal="${demo_signal_dir}/start"
demo_done_signal="${demo_signal_dir}/done"
demo_sync_log="${test_dir}/simulator-demo-sync.log"
SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy \
  LILYSHARK_DEMO_LEAD_MS=0 LILYSHARK_DEMO_STEP_MS=5 LILYSHARK_DEMO_ONCE=1 \
  LILYSHARK_DEMO_START_FILE="${demo_start_signal}" \
  LILYSHARK_DEMO_DONE_FILE="${demo_done_signal}" \
  "${timeout_command}" 10 .pio/build/simulator/program --demo >"${demo_sync_log}" 2>&1 &
demo_sync_pid=$!
sleep 0.1
if grep -q '^UI tour 01/' "${demo_sync_log}"; then
  echo "Synchronized UI tour started before the recording signal" >&2
  kill "${demo_sync_pid}" 2>/dev/null || true
  wait "${demo_sync_pid}" 2>/dev/null || true
  cat "${demo_sync_log}" >&2
  exit 1
fi
touch "${demo_start_signal}"
for _ in $(seq 1 100); do
  [[ -f "${demo_done_signal}" ]] && break
  sleep 0.05
done
if [[ ! -f "${demo_done_signal}" ]] || \
   ! grep -q '^UI tour ready: waiting for recording signal$' "${demo_sync_log}" || \
   ! grep -q '^UI tour recording synchronized; starts in 0.0 seconds$' "${demo_sync_log}" || \
   ! grep -q '^Lilyshark UI tour complete; holding final frame$' "${demo_sync_log}" || \
   [[ "$(grep -c '^UI tour [0-9][0-9]/[0-9][0-9]:' "${demo_sync_log}")" -ne 87 ]]; then
  echo "Simulator recording synchronization did not complete every step" >&2
  kill "${demo_sync_pid}" 2>/dev/null || true
  wait "${demo_sync_pid}" 2>/dev/null || true
  cat "${demo_sync_log}" >&2
  exit 1
fi
kill "${demo_sync_pid}" 2>/dev/null || true
wait "${demo_sync_pid}" 2>/dev/null || true

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
  echo "Continuous simulator soak did not complete all analyzer and shell views" >&2
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
