#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "${script_dir}/.." && pwd)"
dist_dir="${repo_dir}/dist"
first_dir="$(mktemp -d "${TMPDIR:-/tmp}/lilyshark-repro.XXXXXX")"

cleanup() {
  rm -rf -- "${first_dir}"
}
trap cleanup EXIT

artifacts=(
  lilyshark-tdeck.bin
  lilyshark-tdeck.factory.bin
  lilyshark-tdeck.elf
  SHA256SUMS
)

"${script_dir}/build_release.sh"
for artifact in "${artifacts[@]}"; do
  cp "${dist_dir}/${artifact}" "${first_dir}/${artifact}"
done

"${script_dir}/build_release.sh"
for artifact in "${artifacts[@]}"; do
  if ! cmp -s "${first_dir}/${artifact}" "${dist_dir}/${artifact}"; then
    echo "Release build is not reproducible: ${artifact} changed" >&2
    exit 1
  fi
done

echo "Two forced-clean release builds are byte-identical"
