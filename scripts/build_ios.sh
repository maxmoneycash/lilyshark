#!/usr/bin/env bash
#
# Build the vendored PommeCore iOS app for the iOS Simulator.
#
#   ./scripts/build_ios.sh                # build the iOS app for the simulator
#   ./scripts/build_ios.sh --clean        # discard DerivedData first
#   ./scripts/build_ios.sh --scheme X     # build a different scheme
#
# Signing is disabled, so this needs no Apple developer account and no team ID.
# A build for a physical device does need both -- see ios/BUILD.md.
#
# Exits non-zero on any failure, and prints the tail of the build log when it does.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="$REPO_ROOT/ios"
PROJECT="$IOS_DIR/PommeCore.xcodeproj"
DERIVED_DATA="$IOS_DIR/DerivedData"
LOG="$DERIVED_DATA/build_ios.log"

SCHEME="PommeCore"
CLEAN=0

while [ $# -gt 0 ]; do
    case "$1" in
        --clean)  CLEAN=1; shift ;;
        --scheme) SCHEME="${2:?--scheme needs a value}"; shift 2 ;;
        -h|--help)
            sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *)
            echo "build_ios.sh: unknown argument '$1'" >&2
            exit 2 ;;
    esac
done

fail() { echo "" >&2; echo "ERROR: $*" >&2; exit 1; }

# Every prerequisite is checked up front, because each one fails far downstream and
# with a much less obvious message than the check does.
[ "$(uname -s)" = "Darwin" ] || fail "iOS builds require macOS; this is $(uname -s)."
command -v xcodebuild >/dev/null 2>&1 || fail "xcodebuild not found. Install Xcode from the App Store, then: sudo xcode-select -s /Applications/Xcode.app"

XCODE_PATH="$(xcode-select -p 2>/dev/null || true)"
case "$XCODE_PATH" in
    *CommandLineTools*)
        fail "xcode-select points at the Command Line Tools ($XCODE_PATH), which cannot build an app.
   Fix: sudo xcode-select -s /Applications/Xcode.app" ;;
    "") fail "xcode-select is not configured. Fix: sudo xcode-select -s /Applications/Xcode.app" ;;
esac

[ -d "$PROJECT" ] || fail "$PROJECT not found. The vendored iOS app is missing from this checkout."

# The simulator app links MeshCoreKit, which requires iOS 18, so a machine whose Xcode
# ships no iOS 18-or-newer simulator runtime cannot build this at all.
if ! xcrun simctl list runtimes 2>/dev/null | grep -qE '^iOS (1[89]|[2-9][0-9])'; then
    fail "No iOS 18+ simulator runtime installed, and MeshCoreKit requires iOS 18.
   Fix: Xcode -> Settings -> Components, and install an iOS simulator runtime."
fi

mkdir -p "$DERIVED_DATA"

if [ "$CLEAN" -eq 1 ]; then
    echo "==> Cleaning DerivedData"
    rm -rf "${DERIVED_DATA:?}"/*
    mkdir -p "$DERIVED_DATA"
fi

echo "==> Building scheme '$SCHEME' for the iOS Simulator"
echo "    project: $PROJECT"
echo "    log:     $LOG"
echo ""

set +e
xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$DERIVED_DATA" \
    -configuration Debug \
    CODE_SIGNING_ALLOWED=NO \
    build > "$LOG" 2>&1
BUILD_STATUS=$?
set -e

if [ "$BUILD_STATUS" -ne 0 ] || ! grep -q '\*\* BUILD SUCCEEDED \*\*' "$LOG"; then
    echo "----- compiler errors -----" >&2
    grep -E '(^|/).*error:' "$LOG" | sort -u | head -40 >&2 || true
    echo "----- last 40 log lines -----" >&2
    tail -40 "$LOG" >&2
    fail "iOS simulator build FAILED (xcodebuild exit $BUILD_STATUS). Full log: $LOG"
fi

APP="$(find "$DERIVED_DATA/Build/Products" -maxdepth 2 -name '*.app' -print -quit 2>/dev/null || true)"
[ -n "$APP" ] || fail "xcodebuild reported success but produced no .app bundle. Full log: $LOG"

echo "** BUILD SUCCEEDED **"
echo "app: $APP"
