#!/bin/bash
# scripts/test_build.sh — compile-check both iOS and macOS platforms
#
# Usage:
#   ./scripts/test_build.sh           # verify code compiles cleanly
#   ./scripts/test_build.sh --force   # rebuild even if previous build succeeded
#
# This script ONLY builds and verifies. It does NOT change version or build number.
#
# Workflow:
#   1. ./scripts/test_build.sh                              # verify code compiles
#   2. ./build-and-distribute.sh [ios|macos|all]             # TestFlight (bump build)
#   3. ./build-and-distribute.sh [ios|macos|all] --release   # App Store (set YY.MM.R)
#
# On success: outputs "ready to distribute"
# On failure: exits non-zero

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

PBXPROJ="PommeCore.xcodeproj/project.pbxproj"
BUILD_STATUS="BUILD_STATUS.md"
SENTINEL="build/last_build_success"

# Colors
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; NC='\033[0m'
log()   { echo -e "${GREEN}[BUILD]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# --- Parse args: --force flag only ---

FORCE=0
for arg in "$@"; do
    if [ "$arg" = "--force" ]; then
        FORCE=1
    fi
done

# --- 1. Read current build number (don't bump) ---

CURRENT=$(grep "CURRENT_PROJECT_VERSION" "$PBXPROJ" | grep -o '[0-9]*' | sort -n | tail -1)
VERSION=$(grep -m1 "MARKETING_VERSION" "$PBXPROJ" | grep -o '[0-9]*\.[0-9]*\.[0-9]*')

log "Verifying build $CURRENT (v$VERSION) — no bump yet"

# --- 3b. Ensure connected iOS devices have device support installed ---
# When an iPhone running a newer iOS than what Xcode has device support for is
# connected, xcodebuild refuses all iOS destinations — including generic/platform=iOS.
# This function detects that condition and auto-downloads support before archiving.
ensure_ios_device_support() {
    local missing_versions
    missing_versions=$(xcodebuild -showdestinations \
        -project PommeCore.xcodeproj -scheme PommeCore 2>&1 \
        | grep -oE 'iOS [0-9]+\.[0-9]+ is not installed' \
        | grep -oE '[0-9]+\.[0-9]+' | sort -u || true)

    [ -z "$missing_versions" ] && return 0

    for version in $missing_versions; do
        log "iOS $version device support not installed — preparing (this may take a few minutes)..."
        if ! xcodebuild -prepareDeviceSupport -platform iOS -osVersion "$version"; then
            warn "Could not prepare iOS $version device support automatically."
            warn "Fix: open Xcode → Settings → Platforms and download iOS $version, or disconnect your iPhone."
            exit 1
        fi
        log "iOS $version device support ready"
    done
}

ensure_ios_device_support

# --- 4. Archive — iOS (compile + link + package check, no signing) ---
# Use 'archive' not 'build': catches missing entitlements, plist errors, and
# any step that only runs during the archive phase (the same steps distribute uses).

log "Archiving iOS (compile check)..."
mkdir -p build
if ! xcodebuild archive \
    -project PommeCore.xcodeproj \
    -scheme PommeCore \
    -destination "generic/platform=iOS" \
    -configuration Release \
    -archivePath /tmp/bump_build_ios.xcarchive \
    CODE_SIGNING_ALLOWED=NO \
    2>&1 | tee /tmp/bump_build_ios.log | grep -E "error:|warning:|ARCHIVE SUCCEEDED|ARCHIVE FAILED"; then
    error "iOS archive failed — check /tmp/bump_build_ios.log"
    rm -f "$SENTINEL"
    exit 1
fi

if ! grep -q "ARCHIVE SUCCEEDED" /tmp/bump_build_ios.log; then
    error "iOS archive failed — check /tmp/bump_build_ios.log"
    rm -f "$SENTINEL"
    exit 1
fi
log "iOS: ARCHIVE SUCCEEDED"

# --- 5. Archive — macOS (compile + link + package check, no signing) ---

log "Archiving macOS (compile check)..."
if ! xcodebuild archive \
    -project PommeCore.xcodeproj \
    -scheme PommeCore-macOS \
    -destination "generic/platform=macOS" \
    -configuration Release \
    -archivePath /tmp/bump_build_macos.xcarchive \
    CODE_SIGNING_ALLOWED=NO \
    2>&1 | tee /tmp/bump_build_macos.log | grep -E "error:|warning:|ARCHIVE SUCCEEDED|ARCHIVE FAILED"; then
    error "macOS archive failed — check /tmp/bump_build_macos.log"
    rm -f "$SENTINEL"
    exit 1
fi

if ! grep -q "ARCHIVE SUCCEEDED" /tmp/bump_build_macos.log; then
    error "macOS archive failed — check /tmp/bump_build_macos.log"
    rm -f "$SENTINEL"
    exit 1
fi
log "macOS: ARCHIVE SUCCEEDED"

# --- 5a. Verify no errors and report warnings ---

check_build_log() {
    local platform=$1
    local logfile=$2

    # Check for errors (fatal)
    # Exclude lines from system tools (timestamped xcodebuild runtime messages) which
    # can contain "error:" inside ObjC selector names (e.g. SimServiceContext:error:).
    ERRORS=$(grep -i "error:" "$logfile" | grep -v "^warning:" | grep -vE "^\s*[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\." | head -20 || true)
    if [ -n "$ERRORS" ]; then
        error "$platform: Found compilation ERRORS:"
        echo "$ERRORS" >&2
        return 1
    fi

    # Check for Swift source code warnings (fatal — clean builds only)
    # Only catch warnings in .swift files (source code), not system tool warnings
    # Real warnings have format: /path/to/File.swift:42: warning: ...
    # System warnings from appintentsmetadataprocessor don't have .swift: pattern
    WARNINGS=$(grep -E "\.swift:[0-9]+: warning:" "$logfile" | head -20 || true)
    if [ -n "$WARNINGS" ]; then
        error "$platform: Found Swift compilation WARNINGS — clean builds only:"
        echo "$WARNINGS" >&2
        return 1
    fi

    log "$platform: Clean build ✓ (no errors or warnings)"
    return 0
}

log "Verifying clean builds (no errors or warnings)..."
if ! check_build_log "iOS" /tmp/bump_build_ios.log; then
    error "iOS build is not clean — fix warnings/errors and re-run with --force"
    rm -f "$SENTINEL"
    exit 1
fi

if ! check_build_log "macOS" /tmp/bump_build_macos.log; then
    error "macOS build is not clean — fix warnings/errors and re-run with --force"
    rm -f "$SENTINEL"
    exit 1
fi

echo ""
echo -e "${GREEN}✓ Build $CURRENT (v$VERSION) — clean build verified (no errors or warnings).${NC}"
echo -e "  Ready for distribution. Next: ${YELLOW}./build-and-distribute.sh [ios|macos|all]${NC}"
echo ""
