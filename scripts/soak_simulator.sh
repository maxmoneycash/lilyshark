#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "${script_dir}/.." && pwd)"
duration_seconds="${1:-86400}"
soak_log="${LILYSHARK_SOAK_LOG:-/tmp/lilyshark-simulator-soak.log}"

if [[ $# -gt 1 || ! "${duration_seconds}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Usage: scripts/soak_simulator.sh [positive-duration-seconds]" >&2
  exit 2
fi

if ! command -v uvx >/dev/null 2>&1; then
  echo "uvx is required to build the simulator" >&2
  exit 1
fi

if command -v timeout >/dev/null 2>&1; then
  timeout_command="$(command -v timeout)"
elif command -v gtimeout >/dev/null 2>&1; then
  timeout_command="$(command -v gtimeout)"
else
  echo "timeout or gtimeout is required for the simulator soak" >&2
  exit 1
fi

cd "${repo_dir}"
uvx --from platformio==6.1.19 platformio run -e simulator

: >"${soak_log}"
echo "Starting one-process Lilyshark simulator soak for ${duration_seconds}s"
echo "Log: ${soak_log}"

set +e
SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy \
  "${timeout_command}" "${duration_seconds}" .pio/build/simulator/program --soak \
  >"${soak_log}" 2>&1
result=$?
set -e

if [[ ${result} -ne 124 ]]; then
  echo "Simulator exited before the soak deadline (${result})" >&2
  sed -n '1,200p' "${soak_log}" >&2
  exit 1
fi

if grep -Eiq 'assert|abort|sanitizer|segmentation|fatal error' "${soak_log}"; then
  echo "Simulator logged a fatal diagnostic during the soak" >&2
  sed -n '1,200p' "${soak_log}" >&2
  exit 1
fi

cycles="$(grep -c '^Lilyshark soak cycle ' "${soak_log}" || true)"
echo "Simulator soak passed: ${duration_seconds}s, ${cycles} complete nine-screen cycles"
