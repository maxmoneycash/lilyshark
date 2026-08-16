#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "${script_dir}/.." && pwd)"
platformio_version="6.1.19"
intelhex_version="2.3.0"
pip_version="25.2"

for command_name in uvx magick; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "${command_name} is required to generate README media" >&2
    exit 1
  fi
done

work_dir="$(mktemp -d /tmp/lilyshark-readme-media.XXXXXX)"
static_dir="${work_dir}/static"
live_dir="${work_dir}/live"
mkdir -p "${static_dir}" "${live_dir}"
cleanup() {
  rm -rf "${work_dir}"
}
trap cleanup EXIT INT TERM

cd "${repo_dir}"
uvx \
  --with "pip==${pip_version}" \
  --with "intelhex==${intelhex_version}" \
  --from "platformio==${platformio_version}" \
  platformio run -e simulator

LILYSHARK_RENDER_DIR="${static_dir}" \
  .pio/build/simulator/program --render-test
.pio/build/simulator/program --readme-frames "${live_dir}"

preview_dir="${repo_dir}/design/previews"
firmware_preview_dir="${preview_dir}/firmware"
mkdir -p "${preview_dir}" "${firmware_preview_dir}"

render_png() {
  local source="$1"
  local destination="$2"
  magick "${source}" -strip -define png:exclude-chunk=date,time "${destination}"
}

render_png "${static_dir}/shell-01.ppm" "${preview_dir}/splash-simulator.png"
render_png "${static_dir}/shell-03.ppm" "${preview_dir}/onboarding-simulator.png"
render_png "${static_dir}/shell-08.ppm" "${preview_dir}/home-simulator.png"
render_png "${static_dir}/shell-10.ppm" "${preview_dir}/settings-simulator.png"
render_png "${static_dir}/analyzer-01.ppm" "${preview_dir}/traffic-simulator.png"
render_png "${static_dir}/analyzer-02.ppm" "${preview_dir}/traffic-filter-simulator.png"
render_png "${static_dir}/analyzer-03.ppm" "${preview_dir}/protocols-simulator.png"
render_png "${static_dir}/analyzer-04.ppm" "${preview_dir}/protocol-detail-simulator.png"
# Use the deterministic mid-sweep frame so the still shows measured progress,
# not the intentionally empty pre-scan state protected by the render golden.
render_png "${live_dir}/live-040.ppm" "${preview_dir}/spectrum-simulator.png"
render_png "${static_dir}/analyzer-08.ppm" "${preview_dir}/packet-detail-simulator.png"
render_png "${static_dir}/analyzer-12.ppm" "${preview_dir}/timeline-simulator.png"

# Keep the complete README gallery on the same exact-pixel contract as
# --render-test. These names are referenced individually throughout README.md.
analyzer_preview_names=(
  traffic traffic-filter protocols protocol-detail spectrum nodes node-detail
  packet-detail map survey utilization timeline events
)
for index in "${!analyzer_preview_names[@]}"; do
  printf -v frame_name 'analyzer-%02d.ppm' "$((index + 1))"
  render_png "${static_dir}/${frame_name}" \
    "${firmware_preview_dir}/${analyzer_preview_names[index]}.png"
done

shell_preview_names=(
  splash setup-welcome setup-capabilities setup-network setup-profile
  setup-controls setup-ready home radio-profile settings storage device-status
  display-input help about spectrum-warning reset-setup
)
for index in "${!shell_preview_names[@]}"; do
  printf -v frame_name 'shell-%02d.ppm' "$((index + 1))"
  render_png "${static_dir}/${frame_name}" \
    "${firmware_preview_dir}/${shell_preview_names[index]}.png"
done

interaction_preview_names=(
  packet-pkt packet-rf packet-dec packet-hex packet-raw packet-hex-2
  packet-hex-3 event-detail
)
for index in "${!interaction_preview_names[@]}"; do
  printf -v frame_name 'interaction-%02d.ppm' "$((index + 1))"
  render_png "${static_dir}/${frame_name}" \
    "${firmware_preview_dir}/${interaction_preview_names[index]}.png"
done

firmware_preview_count="$(find "${firmware_preview_dir}" -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')"
if [[ "${firmware_preview_count}" -ne 38 ]]; then
  echo "Expected 38 firmware gallery frames, found ${firmware_preview_count}" >&2
  exit 1
fi
for firmware_preview in "${firmware_preview_dir}"/*.png; do
  geometry="$(magick identify -format '%wx%h' "${firmware_preview}")"
  if [[ "${geometry}" != "320x240" ]]; then
    echo "Unexpected firmware preview geometry ${geometry}: ${firmware_preview}" >&2
    exit 1
  fi
done

live_frame_count="$(find "${live_dir}" -type f -name 'live-*.ppm' | wc -l | tr -d ' ')"
if [[ "${live_frame_count}" -ne 118 ]]; then
  echo "Expected 118 deterministic live frames, found ${live_frame_count}" >&2
  exit 1
fi

magick -delay 25 "${live_dir}"/live-*.ppm -loop 0 -colors 96 -dither None \
  -layers Optimize "${preview_dir}/live-diagnostics.gif"

gif_geometry="$(magick identify -format '%wx%h' "${preview_dir}/live-diagnostics.gif[0]")"
if [[ "${gif_geometry}" != "320x240" ]]; then
  echo "Unexpected live GIF geometry: ${gif_geometry}" >&2
  exit 1
fi

echo "README screenshots, 38-frame firmware gallery, and live-diagnostics.gif regenerated"
