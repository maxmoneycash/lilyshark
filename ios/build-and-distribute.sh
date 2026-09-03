#!/bin/bash
set -euo pipefail

# PommeCore Distribute Script
# Archives and uploads to App Store Connect (TestFlight + App Store).
#
# Versioning: marketing version = YY.MM.DD (one version per calendar day).
# The build number resets to 1 on a new day and increments for repeat builds
# the same day. A unique version every day means build 1 is always fresh, so
# iOS and macOS never collide and macOS never rejects a build as "not higher
# than the previously uploaded version". --release only changes the commit
# message (release: vs chore:); both modes use the same date-based versioning.
#
# MUST run scripts/test_build.sh first to verify code compiles cleanly.
#
# Usage:
#   ./build-and-distribute.sh [ios|macos|all]              # TestFlight build
#   ./build-and-distribute.sh [ios|macos|all] --release    # App Store release

SCHEME="PommeCore"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$PROJECT_DIR/build"
ARCHIVE_DATE=$(date '+%Y-%m-%d')
ARCHIVE_DIR="$HOME/Library/Developer/Xcode/Archives/$ARCHIVE_DATE"
EXPORT_DIR="$BUILD_DIR/exports"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

log()   { echo -e "${GREEN}[DIST]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# --- Parse args ---

TARGET="all"
RELEASE_MODE=0

for arg in "$@"; do
    case "$arg" in
        ios|macos|all) TARGET="$arg" ;;
        --release) RELEASE_MODE=1 ;;
    esac
done

# --- Pre-flight ---

cd "$PROJECT_DIR"
PBXPROJ="PommeCore.xcodeproj/project.pbxproj"
CURRENT_VERSION=$(grep "MARKETING_VERSION" "$PBXPROJ" | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
CURRENT_BUILD=$(grep -m1 "CURRENT_PROJECT_VERSION" "$PBXPROJ" | sed -E 's/.*= *([^;]*);.*/\1/')

# App Store Connect credentials — set via environment or .asc.env file
if [[ -f "$PROJECT_DIR/.asc.env" ]]; then
    source "$PROJECT_DIR/.asc.env"
fi

ASC_KEY_ID="${ASC_KEY_ID:?Set ASC_KEY_ID in environment or .asc.env}"
ASC_KEY_ISSUER="${ASC_KEY_ISSUER:?Set ASC_KEY_ISSUER in environment or .asc.env}"
ASC_KEY_PATH="${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8}"

if [[ ! -f "$ASC_KEY_PATH" ]]; then
    error "App Store Connect API key not found at $ASC_KEY_PATH"
fi

# --- Determine version and build ---

# Marketing version (CFBundleShortVersionString) = YY.MM.DD — the number users
# see, one per calendar day.
NEW_VERSION="$(date '+%y.%m.%d')"

# Build number (CFBundleVersion) is a YYYYMMDD.HHMMSS timestamp, stamped fresh
# right before EACH archive in Phase 2. A timestamp strictly increases, so it
# always exceeds the previously uploaded build — which the macOS App Store
# requires (it rejects any build not higher than the prior one; iOS doesn't).
# Upload order never matters: whichever archive is built later is automatically
# higher. Apple caps each CFBundleVersion integer at 2^32-1, so we split
# date.time (each component well under the cap) instead of one 14-digit number.
log "Build: v$NEW_VERSION — timestamp build numbers (target: $TARGET; was $CURRENT_VERSION/$CURRENT_BUILD)"

# Create directories
mkdir -p "$ARCHIVE_DIR" "$EXPORT_DIR"

# Archive paths are set per-platform in Phase 2 (build is a per-archive timestamp).

# ============================================================
# PRE-FLIGHT — Ensure connected iOS devices have device support
# When an iPhone running a newer iOS than what Xcode has device
# support for is connected, xcodebuild refuses all iOS destinations.
# Detect and auto-download support before touching the version number.
# ============================================================

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

if [[ "$TARGET" == "ios" || "$TARGET" == "all" ]]; then
    ensure_ios_device_support
fi

# ============================================================
# PHASE 1 — SET VERSION & BUILD (before archiving)
# The archive must contain the correct values so TestFlight/
# App Store receives them.
# ============================================================

log "Setting version to $NEW_VERSION..."
sed -i '' "s/MARKETING_VERSION = [^;]*/MARKETING_VERSION = $NEW_VERSION/g" "$PBXPROJ"
WRONG_VER=$(grep "MARKETING_VERSION" "$PBXPROJ" | grep -v "= $NEW_VERSION;" || true)
if [ -n "$WRONG_VER" ]; then
    error "Version mismatch — some entries were NOT updated to $NEW_VERSION"
fi
log "Verified: version=$NEW_VERSION"

# Stamp a fresh YYYYMMDD.HHMMSS build number into every target's CURRENT_PROJECT_VERSION.
set_build() {
    sed -i '' "s/CURRENT_PROJECT_VERSION = [^;]*/CURRENT_PROJECT_VERSION = $1/g" "$PBXPROJ"
}

# ============================================================
# PHASE 2 — ARCHIVE (with new version/build)
# If archiving fails, we roll back.
# ============================================================

rollback() {
    warn "Rolling back to v$CURRENT_VERSION build $CURRENT_BUILD..."
    sed -i '' "s/MARKETING_VERSION = [^;]*/MARKETING_VERSION = $CURRENT_VERSION/g" "$PBXPROJ"
    sed -i '' "s/CURRENT_PROJECT_VERSION = [^;]*/CURRENT_PROJECT_VERSION = $CURRENT_BUILD/g" "$PBXPROJ"
    error "Archive failed — rolled back to v$CURRENT_VERSION ($CURRENT_BUILD)"
}

if [[ "$TARGET" == "ios" || "$TARGET" == "all" ]]; then
    IOS_BUILD="$(date '+%Y%m%d.%H%M%S')"
    IOS_ARCHIVE="$ARCHIVE_DIR/PommeCore v$NEW_VERSION ($IOS_BUILD).xcarchive"
    set_build "$IOS_BUILD"
    log "Archiving iOS (v$NEW_VERSION build $IOS_BUILD)..."
    security unlock-keychain -p "" ~/Library/Keychains/login.keychain-db 2>/dev/null || true
    if ! xcodebuild archive \
        -project PommeCore.xcodeproj \
        -scheme "$SCHEME" \
        -destination "generic/platform=iOS" \
        -archivePath "$IOS_ARCHIVE" \
        -allowProvisioningUpdates \
        CODE_SIGN_STYLE=Automatic \
        OTHER_CODE_SIGN_FLAGS="--keychain ~/Library/Keychains/login.keychain-db" \
        2>&1 | tee /tmp/xcodebuild-ios.log | tail -20; then
        rollback
    fi
    if ! grep -q "ARCHIVE SUCCEEDED" /tmp/xcodebuild-ios.log; then
        rollback
    fi
    log "iOS archive complete → v$NEW_VERSION build $IOS_BUILD"
fi

if [[ "$TARGET" == "macos" || "$TARGET" == "all" ]]; then
    MACOS_BUILD="$(date '+%Y%m%d.%H%M%S')"
    MACOS_ARCHIVE="$ARCHIVE_DIR/PommeCore-macOS v$NEW_VERSION ($MACOS_BUILD).xcarchive"
    set_build "$MACOS_BUILD"
    log "Archiving macOS (v$NEW_VERSION build $MACOS_BUILD)..."
    security unlock-keychain -p "" ~/Library/Keychains/login.keychain-db 2>/dev/null || true
    if ! xcodebuild archive \
        -project PommeCore.xcodeproj \
        -scheme "PommeCore-macOS" \
        -destination "generic/platform=macOS" \
        -archivePath "$MACOS_ARCHIVE" \
        -allowProvisioningUpdates \
        CODE_SIGN_STYLE=Automatic \
        OTHER_CODE_SIGN_FLAGS="--keychain ~/Library/Keychains/login.keychain-db" \
        2>&1 | tee /tmp/xcodebuild-macos.log | tail -20; then
        rollback
    fi
    if ! grep -q "ARCHIVE SUCCEEDED" /tmp/xcodebuild-macos.log; then
        rollback
    fi
    log "macOS archive complete → v$NEW_VERSION build $MACOS_BUILD"
fi

# ============================================================
# PHASE 3 — COMMIT & PUSH
# ============================================================

if [[ "$RELEASE_MODE" == "1" ]]; then
    COMMIT_MSG="release: v$NEW_VERSION (build ${MACOS_BUILD:-$IOS_BUILD})"
else
    COMMIT_MSG="chore: build v$NEW_VERSION (build ${MACOS_BUILD:-$IOS_BUILD})"
fi

log "Committing..."
git add "$PBXPROJ"
git diff --cached --quiet || git commit -m "$COMMIT_MSG"

log "Pushing to remote..."
git push
log "Committed and pushed"

# ============================================================
# PHASE 4 — UPLOAD TO APP STORE CONNECT
# ============================================================

if [[ "$TARGET" == "ios" || "$TARGET" == "all" ]]; then
    log "Uploading iOS to App Store Connect..."
    xcodebuild -exportArchive \
        -archivePath "$IOS_ARCHIVE" \
        -exportOptionsPlist "$PROJECT_DIR/ExportOptions-AppStore-iOS.plist" \
        -exportPath "$EXPORT_DIR/iOS-$IOS_BUILD" \
        -allowProvisioningUpdates \
        -authenticationKeyPath "$ASC_KEY_PATH" \
        -authenticationKeyID "$ASC_KEY_ID" \
        -authenticationKeyIssuerID "$ASC_KEY_ISSUER" \
        2>&1 | tee /tmp/xcodebuild-ios-export.log | tail -20
    if [ ${PIPESTATUS[0]} -ne 0 ]; then
        error "iOS upload failed — check /tmp/xcodebuild-ios-export.log"
    fi
    log "iOS uploaded to App Store Connect"
fi

if [[ "$TARGET" == "macos" || "$TARGET" == "all" ]]; then
    log "Uploading macOS to App Store Connect..."
    xcodebuild -exportArchive \
        -archivePath "$MACOS_ARCHIVE" \
        -exportOptionsPlist "$PROJECT_DIR/ExportOptions-AppStore-macOS.plist" \
        -exportPath "$EXPORT_DIR/macOS-$MACOS_BUILD" \
        -allowProvisioningUpdates \
        -authenticationKeyPath "$ASC_KEY_PATH" \
        -authenticationKeyID "$ASC_KEY_ID" \
        -authenticationKeyIssuerID "$ASC_KEY_ISSUER" \
        2>&1 | tee /tmp/xcodebuild-macos-export.log | tail -20
    if [ ${PIPESTATUS[0]} -ne 0 ]; then
        error "macOS upload failed — check /tmp/xcodebuild-macos-export.log"
    fi
    log "macOS uploaded to App Store Connect"
fi

if [[ "$RELEASE_MODE" == "1" ]]; then
    log "Done! RELEASE v$NEW_VERSION uploaded (iOS build ${IOS_BUILD:-—}, macOS build ${MACOS_BUILD:-—})"
    log "Submit in App Store Connect → App Store"
else
    log "Done! v$NEW_VERSION uploaded to TestFlight (iOS build ${IOS_BUILD:-—}, macOS build ${MACOS_BUILD:-—})"
    log "Check App Store Connect → TestFlight for processing status"
fi
