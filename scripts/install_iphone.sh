#!/usr/bin/env bash
# Build Lilyshark for a physical iPhone and install it.
#
# Unlike build_ios.sh, which targets the simulator and never signs anything,
# this puts the app on real hardware -- so it needs a signing identity, an App
# ID registered with the capabilities the entitlements ask for, and the
# phone's UDID in a provisioning profile. Those come from an Apple ID signed
# into Xcode; there is no way around that from a script, and this one says so
# plainly instead of failing three thousand log lines in.
#
# Usage:
#   scripts/install_iphone.sh              # build and install on the attached phone
#   scripts/install_iphone.sh --build-only # build the .app, do not install
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "${script_dir}/.." && pwd)"
ios_dir="${repo_dir}/ios"
project="${ios_dir}/PommeCore.xcodeproj"
derived="${ios_dir}/DerivedData"
log="${derived}/install_iphone.log"
team="RSXSFPWG5J"

build_only=0
case "${1:-}" in
    "") ;;
    --build-only) build_only=1 ;;
    -h|--help) sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "install_iphone.sh: unknown argument '$1'" >&2; exit 2 ;;
esac

fail() { echo "" >&2; echo "ERROR: $*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "iOS builds require macOS; this is $(uname -s)."
command -v xcodebuild >/dev/null 2>&1 || fail "xcodebuild not found. Install Xcode."

# The same guard build_ios.sh runs: an SDK older than a target's deployment
# floor is a warning to Xcode, so it would otherwise build something incoherent
# and call it a success.
python3 "${repo_dir}/scripts/check_ios_toolchain.py" \
    || fail "the selected Xcode cannot build every target this project declares (see above)"

# Signing needs an account. Checked up front because the failure otherwise
# arrives as "No Accounts: Add a new account in Accounts settings" buried among
# a dozen provisioning errors that all have the same single cause.
if ! security find-identity -v -p codesigning 2>/dev/null | grep -q "${team}"; then
    fail "no codesigning identity for team ${team} on this machine.
  Open Xcode > Settings > Accounts, add the Apple ID that owns team ${team},
  and select it under Manage Certificates. Nothing else here can proceed
  without it -- Apple requires an authenticated account to issue a profile."
fi

mkdir -p "${derived}"

echo "==> Building Lilyshark for a physical iPhone"
echo "    team:   ${team}"
echo "    log:    ${log}"

# -allowProvisioningUpdates lets Xcode register the App IDs and create the
# profiles. It needs the signed-in account checked for above; without one it
# reports "No Accounts" rather than doing nothing quietly.
set +e
xcodebuild \
    -project "${project}" \
    -scheme PommeCore \
    -destination 'generic/platform=iOS' \
    -derivedDataPath "${derived}" \
    -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="${team}" \
    build >"${log}" 2>&1
status=$?
set -e

if [ ${status} -ne 0 ]; then
    echo ""
    echo "Build failed. The errors, deduplicated:" >&2
    grep -E "error:" "${log}" | sed 's/^/  /' | sort -u | head -20 >&2
    echo "" >&2
    echo "Full log: ${log}" >&2
    # The commonest cause by far, named rather than left to be guessed at.
    if grep -q "doesn't include the .* capability\|doesn't support the .* App Group" "${log}"; then
        echo "" >&2
        echo "The App ID exists but is missing capabilities the entitlements ask for" >&2
        echo "(App Groups, iCloud). Xcode adds these automatically when the signed-in" >&2
        echo "account has admin rights on team ${team}. If it does not, add them by" >&2
        echo "hand at developer.apple.com > Identifiers > com.lilyshark.app." >&2
    fi
    exit 1
fi

app="$(find "${derived}/Build/Products" -maxdepth 2 -name 'PommeCore.app' -path '*iphoneos*' | head -1)"
[ -n "${app}" ] || fail "the build succeeded but produced no iphoneos PommeCore.app"

echo ""
echo "** BUILD SUCCEEDED **"
echo "app: ${app}"

[ ${build_only} -eq 1 ] && exit 0

echo ""
echo "==> Looking for an attached iPhone"
devices="$(xcrun devicectl list devices 2>/dev/null || true)"
if ! echo "${devices}" | grep -qiE "iphone|ipad"; then
    echo "No iPhone found over USB." >&2
    echo "" >&2
    echo "Plug the phone in, unlock it, and tap Trust if asked. The app is" >&2
    echo "built and waiting at:" >&2
    echo "  ${app}" >&2
    echo "" >&2
    echo "Then re-run this script, or drag that bundle onto the device in" >&2
    echo "Xcode > Window > Devices and Simulators." >&2
    exit 1
fi

identifier="$(echo "${devices}" | awk '/[Ii]([Pp])hone|iPad/ {print $(NF-2); exit}')"
[ -n "${identifier}" ] || fail "found a device but could not read its identifier from devicectl"

echo "    device: ${identifier}"
xcrun devicectl device install app --device "${identifier}" "${app}"

echo ""
echo "Installed. On the phone, trust the developer certificate under"
echo "Settings > General > VPN & Device Management before the app will open."
