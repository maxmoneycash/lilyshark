#!/usr/bin/env bash
# Pre-flight for a T-Deck flash: everything that can be checked without the
# device attached, plus a port report. Read-only — it never writes the board.
set -uo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${repo_dir}/dist/lilyshark-tdeck.factory.bin"
checksums="${repo_dir}/dist/SHA256SUMS"
ok=0
fail=0

pass() { printf '  \033[32mOK\033[0m   %s\n' "$1"; ok=$((ok + 1)); }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=$((fail + 1)); }
note() { printf '  --   %s\n' "$1"; }

echo "Lilyshark T-Deck pre-flight"
echo

# 1. Image present, non-empty, and a real ESP32 image (magic byte 0xE9).
if [[ -s "${image}" ]]; then
  size=$(wc -c < "${image}" | tr -d ' ')
  magic=$(xxd -p -l 1 "${image}")
  if [[ "${magic}" == "e9" ]]; then
    pass "factory image present and valid (${size} bytes, magic e9)"
  else
    bad "factory image has magic 0x${magic}, expected 0xe9"
  fi
else
  bad "factory image missing: ${image}"
fi

# 2. Checksum manifest matches the image the script will actually write.
if [[ -f "${checksums}" ]] && (cd "${repo_dir}/dist" && shasum -a 256 -c SHA256SUMS >/dev/null 2>&1); then
  pass "SHA256SUMS matches the staged image"
else
  bad "checksum missing or mismatched — flash_tdeck.sh will refuse"
fi

# 3. The staged image is not older than the compiled artifact.
built="${repo_dir}/.pio/build/t-deck/firmware.factory.bin"
if [[ -f "${built}" ]]; then
  if cmp -s "${built}" "${image}"; then
    pass "staged image is byte-identical to the current build"
  else
    bad "staged image differs from .pio build — restage before flashing"
  fi
else
  note "no local build to compare against (using a downloaded release?)"
fi

# 4. Toolchain: pinned esptool must already be fetched so the flash is instant.
if command -v uvx >/dev/null 2>&1; then
  if uvx --from esptool==4.11.0 esptool.py version >/dev/null 2>&1; then
    pass "esptool 4.11.0 available and warm"
  else
    bad "uvx present but esptool 4.11.0 could not run"
  fi
else
  bad "uvx missing — required to run the pinned esptool"
fi

# 5. First-boot checker and its dependency.
if [[ -f "${repo_dir}/scripts/smoke_tdeck.py" ]] && python3 -c "import serial" 2>/dev/null; then
  pass "first-boot checker ready (smoke_tdeck.py + pyserial)"
else
  bad "smoke_tdeck.py or pyserial unavailable"
fi

# 6. Ports. Zero is expected until the board is plugged in and powered on.
shopt -s nullglob
ports=(/dev/cu.usbmodem* /dev/ttyACM*)
shopt -u nullglob
echo
if [[ ${#ports[@]} -eq 1 ]]; then
  pass "exactly one serial device: ${ports[0]}"
  echo
  echo "Ready. Flash with:"
  echo "  ./scripts/flash_tdeck.sh --auto"
elif [[ ${#ports[@]} -eq 0 ]]; then
  note "no serial device yet — plug in the T-Deck with a USB *data* cable and power it on"
else
  note "${#ports[@]} serial devices present; pass the T-Deck port explicitly:"
  printf '       %s\n' "${ports[@]}"
fi

echo
printf 'checks passed: %d   failed: %d\n' "${ok}" "${fail}"
[[ ${fail} -eq 0 ]] || exit 1
