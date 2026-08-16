#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "${script_dir}/.." && pwd)"
platformio_version="6.1.19"
intelhex_version="2.3.0"
pip_version="25.2"
tour_step_count=87
check_timeout_seconds=15
tour_timeout_seconds=220
# The scripted holds total 151.8 seconds. The recorder starts before the
# synchronized 3-second lead, so 160 seconds leaves a short Home outro while
# still finalizing through the recorder's bounded duration path.
recorder_limit_seconds=160
caffeinate_timeout_seconds=190
minimum_movie_bytes=1000000
minimum_movie_seconds=140
maximum_movie_seconds=190
minimum_movie_width=960
minimum_movie_height=720
window_lookup_timeout_seconds=15

usage() {
  cat <<'EOF'
Usage:
  scripts/run_ui_demo.sh
  scripts/run_ui_demo.sh --check
  scripts/run_ui_demo.sh --record [output.mov]
  scripts/run_ui_demo.sh --record-manual [output.mov]

Builds the desktop simulator and verifies its deterministic renders, live motion,
and complete 87-step tour. With no option, it then opens a 3x simulator window
and repeats the tour for rehearsal.

--check runs the build and preflight checks without opening a visible window.

--record is available on macOS. It captures the dedicated simulator window
automatically, then records one synchronized pass while the synthetic data moves.

--record-manual keeps the simulator on its pink splash while you select a
960x720 recording region and confirm that the recorder is running.
EOF
}

mode="tour"
manual_recording=false
output="${repo_dir}/.pio/recordings/lilyshark-ui-tour.mov"
case "${1:-}" in
  "")
    [[ $# -eq 0 ]] || {
      usage >&2
      exit 2
    }
    ;;
  --check)
    [[ $# -eq 1 ]] || {
      usage >&2
      exit 2
    }
    mode="check"
    ;;
  --record)
    [[ $# -le 2 ]] || {
      usage >&2
      exit 2
    }
    mode="record"
    if [[ -n "${2:-}" ]]; then
      output="$2"
    fi
    ;;
  --record-manual)
    [[ $# -le 2 ]] || {
      usage >&2
      exit 2
    }
    mode="record"
    manual_recording=true
    if [[ -n "${2:-}" ]]; then
      output="$2"
    fi
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

if ! command -v uvx >/dev/null 2>&1; then
  echo "uvx is required to build the simulator" >&2
  exit 1
fi

if [[ "${mode}" == "record" ]]; then
  if [[ "$(uname -s)" != Darwin ]]; then
    echo "--record uses the macOS screen recorder; run without it on this system" >&2
    exit 1
  fi
  if ! command -v screencapture >/dev/null 2>&1; then
    echo "macOS screencapture was not found" >&2
    exit 1
  fi
  if ! command -v file >/dev/null 2>&1; then
    echo "file is required to validate the recorded movie" >&2
    exit 1
  fi
  if [[ -e "${output}" ]]; then
    echo "Refusing to overwrite an existing recording: ${output}" >&2
    exit 1
  fi
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/lilyshark-ui-demo.XXXXXX")"
check_pid=""
simulator_pid=""
recorder_pid=""
caffeinate_pid=""
recording_path=""
capture_method=""
window_id=""
window_width=""
window_height=""
cleanup() {
  if [[ -n "${caffeinate_pid}" ]] && kill -0 "${caffeinate_pid}" 2>/dev/null; then
    kill "${caffeinate_pid}" 2>/dev/null || true
    wait "${caffeinate_pid}" 2>/dev/null || true
  fi
  if [[ -n "${recorder_pid}" ]] && kill -0 "${recorder_pid}" 2>/dev/null; then
    kill -TERM "${recorder_pid}" 2>/dev/null || true
    wait "${recorder_pid}" 2>/dev/null || true
  fi
  if [[ -n "${simulator_pid}" ]] && kill -0 "${simulator_pid}" 2>/dev/null; then
    kill "${simulator_pid}" 2>/dev/null || true
    wait "${simulator_pid}" 2>/dev/null || true
  fi
  if [[ -n "${check_pid}" ]] && kill -0 "${check_pid}" 2>/dev/null; then
    kill "${check_pid}" 2>/dev/null || true
    wait "${check_pid}" 2>/dev/null || true
  fi
  if [[ -d "${work_dir}" ]]; then
    rm -f \
      "${work_dir}/render.log" \
      "${work_dir}/animation.log" \
      "${work_dir}/fast-demo.log" \
      "${work_dir}/recording-demo.log" \
      "${work_dir}/recorder.log" \
      "${work_dir}/black-detection.log" \
      "${work_dir}/caffeinate.log" \
      "${work_dir}/window-helper.log" \
      "${work_dir}/window-recorder-build.log" \
      "${work_dir}/macos-window-id" \
      "${work_dir}/macos-window-recorder" \
      "${work_dir}/automatic-recording.mov" \
      "${work_dir}/start" \
      "${work_dir}/done"
    rmdir "${work_dir}" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

run_with_deadline() {
  local limit_seconds="$1"
  local log_path="$2"
  shift 2

  "$@" >"${log_path}" 2>&1 &
  check_pid=$!
  local deadline=$((SECONDS + limit_seconds))
  while kill -0 "${check_pid}" 2>/dev/null; do
    if (( SECONDS >= deadline )); then
      kill "${check_pid}" 2>/dev/null || true
      wait "${check_pid}" 2>/dev/null || true
      check_pid=""
      return 124
    fi
    sleep 0.05
  done

  local result=0
  wait "${check_pid}" || result=$?
  check_pid=""
  return "${result}"
}

run_preflight() {
  local label="$1"
  local log_path="$2"
  local success_line="$3"
  shift 3

  echo "${label}"
  local result=0
  run_with_deadline "${check_timeout_seconds}" "${log_path}" "$@" || result=$?
  if [[ ${result} -ne 0 ]] || ! grep -Fqx "${success_line}" "${log_path}"; then
    echo "${label} failed (exit ${result})" >&2
    cat "${log_path}" >&2
    exit 1
  fi
}

validate_tour_log() {
  local log_path="$1"
  local completion_line="$2"
  local observed_steps
  observed_steps="$(awk '/^UI tour [0-9][0-9]\/87:/{count += 1} END{print count + 0}' "${log_path}")"

  if [[ "${observed_steps}" -ne "${tour_step_count}" ]] ||
     ! grep -Eq '^UI tour 01/87:' "${log_path}" ||
     ! grep -Eq '^UI tour 87/87:' "${log_path}" ||
     ! grep -Fqx "${completion_line}" "${log_path}"; then
    echo "The simulator did not complete the expected ${tour_step_count}-step tour" >&2
    cat "${log_path}" >&2
    return 1
  fi
}

wait_for_log_line() {
  local log_path="$1"
  local expected_line="$2"
  local process_id="$3"
  local limit_seconds="$4"
  local deadline=$((SECONDS + limit_seconds))

  while ! grep -Fqx "${expected_line}" "${log_path}" 2>/dev/null; do
    if ! kill -0 "${process_id}" 2>/dev/null; then
      return 1
    fi
    if (( SECONDS >= deadline )); then
      return 1
    fi
    sleep 0.05
  done
}

wait_for_process_stability() {
  local process_id="$1"
  local checks=0
  while (( checks < 20 )); do
    if ! kill -0 "${process_id}" 2>/dev/null; then
      return 1
    fi
    sleep 0.05
    checks=$((checks + 1))
  done
}

find_simulator_window() {
  local helper_source="${script_dir}/macos_window_id.swift"
  local helper_binary="${work_dir}/macos-window-id"
  local helper_log="${work_dir}/window-helper.log"

  if ! command -v swiftc >/dev/null 2>&1 || [[ ! -f "${helper_source}" ]]; then
    echo "Automatic window capture needs the macOS Swift compiler and ${helper_source}" >&2
    return 1
  fi
  if ! swiftc -O "${helper_source}" -o "${helper_binary}" >"${helper_log}" 2>&1; then
    echo "The simulator window helper did not compile" >&2
    cat "${helper_log}" >&2
    return 1
  fi

  local deadline=$((SECONDS + window_lookup_timeout_seconds))
  local match=""
  local helper_result=0
  while (( SECONDS < deadline )); do
    if match="$("${helper_binary}" "${simulator_pid}" "Lilyshark UI Tour" \
        "${minimum_movie_width}" "${minimum_movie_height}" 2>/dev/null)"; then
      read -r window_id window_width window_height <<<"${match}"
      if [[ "${window_id}" =~ ^[0-9]+$ ]] &&
         [[ "${window_width}" =~ ^[0-9]+$ ]] &&
         [[ "${window_height}" =~ ^[0-9]+$ ]] &&
         (( window_width >= minimum_movie_width && window_height >= minimum_movie_height )); then
        return 0
      fi
    else
      helper_result=$?
      if [[ ${helper_result} -eq 3 ]]; then
        "${helper_binary}" "${simulator_pid}" "Lilyshark UI Tour" \
          "${minimum_movie_width}" "${minimum_movie_height}" >"${helper_log}" 2>&1 || true
        echo "Automatic window capture does not have Screen Recording permission" >&2
        cat "${helper_log}" >&2
        return 1
      fi
    fi
    if ! kill -0 "${simulator_pid}" 2>/dev/null; then
      return 1
    fi
    sleep 0.1
  done

  "${helper_binary}" "${simulator_pid}" "Lilyshark UI Tour" \
    "${minimum_movie_width}" "${minimum_movie_height}" >"${helper_log}" 2>&1 || true
  echo "The dedicated Lilyshark simulator window was not found safely" >&2
  cat "${helper_log}" >&2
  return 1
}

start_automatic_recorder() {
  if ! find_simulator_window; then
    return 1
  fi

  local recorder_source="${script_dir}/macos_window_recorder.swift"
  local recorder_binary="${work_dir}/macos-window-recorder"
  local recorder_build_log="${work_dir}/window-recorder-build.log"
  if [[ ! -f "${recorder_source}" ]]; then
    echo "Automatic capture needs ${recorder_source}" >&2
    return 1
  fi
  if ! swiftc -parse-as-library -O "${recorder_source}" -o "${recorder_binary}" \
      >"${recorder_build_log}" 2>&1; then
    echo "The ScreenCaptureKit window recorder did not compile" >&2
    cat "${recorder_build_log}" >&2
    return 1
  fi

  recording_path="${work_dir}/automatic-recording.mov"
  echo "Capturing Lilyshark window ${window_id} (${window_width}x${window_height})."
  (
    # Desktop-independent ScreenCaptureKit capture stays attached to this
    # exact window even if another app briefly occludes it or changes Spaces.
    trap - INT
    exec "${recorder_binary}" "${window_id}" "${recorder_limit_seconds}" \
      "${recording_path}"
  ) >"${work_dir}/recorder.log" 2>&1 &
  recorder_pid=$!
  if ! wait_for_process_stability "${recorder_pid}"; then
    wait "${recorder_pid}" 2>/dev/null || true
    recorder_pid=""
    echo "Automatic window recording did not start" >&2
    cat "${work_dir}/recorder.log" >&2
    return 1
  fi

  capture_method="desktop-independent ScreenCaptureKit window capture"
  return 0
}

start_recording_caffeinate() {
  if ! command -v caffeinate >/dev/null 2>&1; then
    echo "macOS caffeinate is required to keep a hands-off tour visible" >&2
    return 1
  fi

  caffeinate -d -i -u -t "${caffeinate_timeout_seconds}" \
    >"${work_dir}/caffeinate.log" 2>&1 &
  caffeinate_pid=$!
  sleep 0.1
  if ! kill -0 "${caffeinate_pid}" 2>/dev/null; then
    wait "${caffeinate_pid}" 2>/dev/null || true
    caffeinate_pid=""
    echo "Could not prevent display sleep during the recording" >&2
    return 1
  fi
  return 0
}

start_manual_recorder() {
  if [[ ! -t 0 ]]; then
    echo "Automatic capture failed and manual selection needs an interactive terminal" >&2
    echo "Run scripts/run_ui_demo.sh --record-manual from Terminal" >&2
    return 1
  fi

  recording_path="${output}"
  echo
  echo "The simulator is holding on its pink splash."
  echo "Select at least its 960x720 content area in the macOS recorder."
  echo "Saving to: ${output}"
  (
    trap - INT
    exec screencapture -v -x -Jvideo -V"${recorder_limit_seconds}" \
      "${recording_path}"
  ) >"${work_dir}/recorder.log" 2>&1 &
  recorder_pid=$!
  if ! IFS= read -r -p "After the recording indicator appears, press Return to start the tour: "; then
    echo "Recording start was not confirmed" >&2
    return 1
  fi
  if ! kill -0 "${recorder_pid}" 2>/dev/null; then
    wait "${recorder_pid}" 2>/dev/null || true
    recorder_pid=""
    echo "Screen recording was cancelled before the tour started" >&2
    cat "${work_dir}/recorder.log" >&2
    return 1
  fi

  capture_method="manual region capture"
  return 0
}

cd "${repo_dir}"
pio=(
  uvx
  --with "pip==${pip_version}"
  --with "intelhex==${intelhex_version}"
  --from "platformio==${platformio_version}"
  platformio
)

echo "Building the Lilyshark simulator"
"${pio[@]}" run -e simulator

run_preflight \
  "Preflight 1/3: checking deterministic pixels" \
  "${work_dir}/render.log" \
  "Lilyshark simulator render test passed" \
  env SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy \
  .pio/build/simulator/program --render-test

run_preflight \
  "Preflight 2/3: checking motion on every live analyzer" \
  "${work_dir}/animation.log" \
  "Lilyshark simulator animation test passed" \
  env SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy \
  .pio/build/simulator/program --animation-test

echo "Preflight 3/3: checking all ${tour_step_count} scripted steps"
fast_demo_log="${work_dir}/fast-demo.log"
fast_demo_result=0
run_with_deadline \
  "${check_timeout_seconds}" \
  "${fast_demo_log}" \
  env SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy \
  LILYSHARK_DEMO_LEAD_MS=0 \
  LILYSHARK_DEMO_STEP_MS=5 \
  LILYSHARK_DEMO_ONCE=1 \
  .pio/build/simulator/program --demo || fast_demo_result=$?
if [[ ${fast_demo_result} -ne 0 ]] ||
   ! validate_tour_log "${fast_demo_log}" "Lilyshark UI tour test passed"; then
  if [[ ${fast_demo_result} -ne 0 ]]; then
    echo "Fast tour preflight failed (exit ${fast_demo_result})" >&2
    cat "${fast_demo_log}" >&2
  fi
  exit 1
fi
echo "Preflight passed: deterministic pixels, visible motion, and ${tour_step_count} tour steps"

if [[ "${mode}" == "check" ]]; then
  exit 0
fi

lead_ms=5000
if [[ "${mode}" == "record" ]]; then
  if [[ -e "${output}" ]]; then
    echo "Refusing to overwrite an existing recording: ${output}" >&2
    exit 1
  fi
  mkdir -p "$(dirname "${output}")"
  lead_ms=3000
  start_signal="${work_dir}/start"
  done_signal="${work_dir}/done"
  recording_demo_log="${work_dir}/recording-demo.log"

  LILYSHARK_DEMO_LEAD_MS="${lead_ms}" \
    LILYSHARK_DEMO_ONCE=1 \
    LILYSHARK_DEMO_START_FILE="${start_signal}" \
    LILYSHARK_DEMO_DONE_FILE="${done_signal}" \
    .pio/build/simulator/program --demo >"${recording_demo_log}" 2>&1 &
  simulator_pid=$!

  if ! wait_for_log_line \
      "${recording_demo_log}" \
      "UI tour ready: waiting for recording signal" \
      "${simulator_pid}" \
      15; then
    echo "The simulator did not reach its recording-ready state" >&2
    cat "${recording_demo_log}" >&2
    exit 1
  fi

  echo
  echo "The 3x simulator is open and holding on its pink splash."
  if ! start_recording_caffeinate; then
    exit 1
  fi
  if [[ "${manual_recording}" == false ]]; then
    echo "Finding its dedicated window for automatic recording."
    if ! start_automatic_recorder; then
      echo "Falling back to manual region selection."
      if ! start_manual_recorder; then
        exit 1
      fi
    fi
  elif ! start_manual_recorder; then
    exit 1
  fi

  if ! kill -0 "${recorder_pid}" 2>/dev/null; then
    echo "Screen recording stopped before the tour start signal" >&2
    cat "${work_dir}/recorder.log" >&2
    exit 1
  fi
  echo "Recorder ready (${capture_method}); starting the tour after the 3-second lead."

  touch "${start_signal}"
  if ! wait_for_log_line \
      "${recording_demo_log}" \
      "UI tour recording synchronized; starts in 3.0 seconds" \
      "${simulator_pid}" \
      10; then
    echo "The simulator did not acknowledge the recording start signal" >&2
    cat "${recording_demo_log}" >&2
    exit 1
  fi

  deadline=$((SECONDS + tour_timeout_seconds))
  while [[ ! -f "${done_signal}" ]]; do
    if ! kill -0 "${simulator_pid}" 2>/dev/null; then
      wait "${simulator_pid}" 2>/dev/null || true
      simulator_pid=""
      echo "The simulator stopped before completing the UI tour" >&2
      cat "${recording_demo_log}" >&2
      exit 1
    fi
    if ! kill -0 "${recorder_pid}" 2>/dev/null; then
      wait "${recorder_pid}" 2>/dev/null || true
      recorder_pid=""
      echo "Screen recording stopped before the UI tour completed" >&2
      cat "${work_dir}/recorder.log" >&2
      exit 1
    fi
    if (( SECONDS >= deadline )); then
      echo "Timed out waiting for the UI tour to complete" >&2
      cat "${recording_demo_log}" >&2
      exit 1
    fi
    sleep 0.1
  done

  if ! wait_for_log_line \
      "${recording_demo_log}" \
      "Lilyshark UI tour complete; holding final frame" \
      "${simulator_pid}" \
      5; then
    echo "The simulator wrote a completion signal without a final completion state" >&2
    cat "${recording_demo_log}" >&2
    exit 1
  fi
  if ! validate_tour_log \
      "${recording_demo_log}" \
      "Lilyshark UI tour complete; holding final frame"; then
    exit 1
  fi

  recorder_stop_deadline=$((SECONDS + 15))
  while kill -0 "${recorder_pid}" 2>/dev/null; do
    if (( SECONDS >= recorder_stop_deadline )); then
      echo "Screen recorder did not finalize after the synchronized completion signal" >&2
      kill -TERM "${recorder_pid}" 2>/dev/null || true
      wait "${recorder_pid}" 2>/dev/null || true
      recorder_pid=""
      exit 1
    fi
    sleep 0.05
  done
  recorder_result=0
  wait "${recorder_pid}" 2>/dev/null || recorder_result=$?
  recorder_pid=""

  kill "${simulator_pid}" 2>/dev/null || true
  wait "${simulator_pid}" 2>/dev/null || true
  simulator_pid=""

  if [[ ! -s "${recording_path}" ]]; then
    echo "Screen recorder did not produce a movie: ${recording_path}" >&2
    exit 1
  fi
  recording_size="$(stat -f '%z' "${recording_path}")"
  if (( recording_size < minimum_movie_bytes )); then
    echo "Recorded movie is unexpectedly small (${recording_size} bytes): ${recording_path}" >&2
    exit 1
  fi
  movie_type="$(file -b --mime-type -- "${recording_path}")"
  if [[ "${movie_type}" != video/* ]]; then
    echo "Recorded output is not a recognized video (${movie_type}): ${recording_path}" >&2
    exit 1
  fi

  movie_duration=""
  movie_width=""
  movie_height=""
  probe_name=""
  probe_ok=false
  if command -v ffprobe >/dev/null 2>&1; then
    if movie_duration="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "${recording_path}")" &&
       movie_dimensions="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "${recording_path}")"; then
      movie_duration="${movie_duration%%$'\n'*}"
      movie_dimensions="${movie_dimensions%%$'\n'*}"
      movie_width="${movie_dimensions%x*}"
      movie_height="${movie_dimensions#*x}"
      if [[ "${movie_duration}" =~ ^[0-9]+([.][0-9]+)?$ ]] &&
         [[ "${movie_width}" =~ ^[0-9]+$ ]] && [[ "${movie_height}" =~ ^[0-9]+$ ]]; then
        probe_name="ffprobe"
        probe_ok=true
      fi
    fi
  fi
  if [[ "${probe_ok}" == false ]] && command -v mdls >/dev/null 2>&1; then
    probe_name="macOS metadata"
    metadata_checks=0
    while (( metadata_checks < 20 )); do
      movie_duration="$(mdls -raw -name kMDItemDurationSeconds "${recording_path}" 2>/dev/null || true)"
      movie_width="$(mdls -raw -name kMDItemPixelWidth "${recording_path}" 2>/dev/null || true)"
      movie_height="$(mdls -raw -name kMDItemPixelHeight "${recording_path}" 2>/dev/null || true)"
      if [[ "${movie_duration}" =~ ^[0-9]+([.][0-9]+)?$ ]] &&
         [[ "${movie_width}" =~ ^[0-9]+$ ]] && [[ "${movie_height}" =~ ^[0-9]+$ ]]; then
        probe_ok=true
        break
      fi
      sleep 0.1
      metadata_checks=$((metadata_checks + 1))
    done
  fi
  if [[ "${probe_ok}" == false ]]; then
    echo "Neither ffprobe nor macOS mdls could validate the recorded movie" >&2
    exit 1
  fi

  if ! awk -v duration="${movie_duration}" -v minimum="${minimum_movie_seconds}" \
      'BEGIN { exit !(duration + 0 >= minimum + 0) }'; then
    echo "Recorded movie is too short (${movie_duration}s): ${recording_path}" >&2
    exit 1
  fi
  if ! awk -v duration="${movie_duration}" -v maximum="${maximum_movie_seconds}" \
      'BEGIN { exit !(duration + 0 <= maximum + 0) }'; then
    echo "Recorded movie contains an unexpected frozen tail (${movie_duration}s): ${recording_path}" >&2
    exit 1
  fi
  if (( movie_width < minimum_movie_width || movie_height < minimum_movie_height )); then
    echo "Recorded frame is too small (${movie_width}x${movie_height}): ${recording_path}" >&2
    exit 1
  fi

  blackout_check="not available"
  if command -v ffmpeg >/dev/null 2>&1; then
    black_detection_log="${work_dir}/black-detection.log"
    if ! ffmpeg -hide_banner -nostats -i "${recording_path}" \
        -vf "blackdetect=d=1.0:pix_th=0.02:pic_th=0.995" \
        -an -f null - >"${black_detection_log}" 2>&1; then
      echo "ffmpeg could not inspect the recorded movie for display blanking" >&2
      tail -40 "${black_detection_log}" >&2
      exit 1
    fi
    if grep -q 'black_start:' "${black_detection_log}"; then
      echo "Recorded movie contains a display blackout of at least one second" >&2
      grep 'black_start:' "${black_detection_log}" >&2
      exit 1
    fi
    blackout_check="no one-second display blackouts"
  fi

  if [[ "${recording_path}" != "${output}" ]]; then
    if ! mv "${recording_path}" "${output}"; then
      echo "The validated recording could not be moved to ${output}" >&2
      exit 1
    fi
    recording_path="${output}"
  fi

  echo "Validated ${movie_width}x${movie_height}, ${movie_duration}s, ${recording_size} bytes (${probe_name}; ${blackout_check})"

  if [[ ${recorder_result} -ne 0 && ${recorder_result} -ne 130 ]]; then
    echo "The recorder exited with status ${recorder_result}, but the completed movie passed validation" >&2
  fi
  echo "UI recording saved: ${output} (${capture_method})"
  exit 0
fi

echo "Opening the repeating ${tour_step_count}-step rehearsal tour"
LILYSHARK_DEMO_LEAD_MS="${lead_ms}" .pio/build/simulator/program --demo &
simulator_pid=$!
tour_result=0
wait "${simulator_pid}" || tour_result=$?
simulator_pid=""
exit "${tour_result}"
