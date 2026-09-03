#!/bin/bash
# scripts/verify_principles.sh — verify project critical rules and design principles
#
# Usage:
#   ./scripts/verify_principles.sh           # run all checks
#   ./scripts/verify_principles.sh --quiet   # only show failures
#
# This script performs static analysis to catch violations of the project's
# critical rules and design principles. Run alongside test_build.sh.
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more violations found

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# Colors
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'

QUIET=0
FAILURES=0
WARNINGS=0
CHECKS=0

for arg in "$@"; do
    [ "$arg" = "--quiet" ] && QUIET=1
done

pass() { CHECKS=$((CHECKS + 1)); [ "$QUIET" -eq 0 ] && echo -e "  ${GREEN}✓${NC} $1"; }
fail() { CHECKS=$((CHECKS + 1)); FAILURES=$((FAILURES + 1)); echo -e "  ${RED}✗${NC} $1"; }
warn() { WARNINGS=$((WARNINGS + 1)); echo -e "  ${YELLOW}!${NC} $1"; }
section() { echo -e "\n${CYAN}[$1]${NC}"; }

# =============================================================================
section "RULE 1: Never delete enum cases persisted via JSON/Codable"
# =============================================================================
# Can't fully verify deletions without git diff, but check that Codable enums
# have explicit raw values (prevents accidental reordering breakage).

CODABLE_ENUMS_WITHOUT_RAW=0
while IFS= read -r file; do
    # Find enums that conform to Codable/CodingKey but lack explicit raw values
    if grep -q 'enum.*:.*Codable' "$file" 2>/dev/null; then
        # Check for cases without explicit = assignment (rough heuristic)
        ENUM_BLOCK=$(awk '/enum.*:.*Codable/,/^}/' "$file" 2>/dev/null || true)
        BARE_CASES=$(echo "$ENUM_BLOCK" | grep -c '^\s*case [a-zA-Z]' 2>/dev/null || true)
        VALUED_CASES=$(echo "$ENUM_BLOCK" | grep -c '^\s*case.*=' 2>/dev/null || true)
        if [ "$BARE_CASES" -gt 0 ] && [ "$VALUED_CASES" -eq 0 ]; then
            CODABLE_ENUMS_WITHOUT_RAW=$((CODABLE_ENUMS_WITHOUT_RAW + 1))
            warn "Codable enum without explicit raw values: $file"
        fi
    fi
done < <(find "$PROJECT_DIR/Packages" "$PROJECT_DIR/Shared" -name "*.swift" 2>/dev/null)

if [ "$CODABLE_ENUMS_WITHOUT_RAW" -eq 0 ]; then
    pass "All Codable enums have explicit raw values (safe against reordering)"
fi

# =============================================================================
section "RULE 3: @Published property setters must run on MainActor"
# =============================================================================
# Check that classes with @Published are marked @MainActor

PUBLISHED_VIOLATIONS=0
while IFS= read -r file; do
    if grep -q '@Published' "$file" 2>/dev/null; then
        # Get class declaration line(s) — check for @MainActor
        CLASS_LINES=$(grep -n 'class.*ObservableObject' "$file" 2>/dev/null || true)
        while IFS= read -r class_line; do
            [ -z "$class_line" ] && continue
            LINE_NUM=$(echo "$class_line" | cut -d: -f1)
            # Check if @MainActor appears in the 3 lines before the class declaration
            PREV_START=$((LINE_NUM > 3 ? LINE_NUM - 3 : 1))
            CONTEXT=$(sed -n "${PREV_START},${LINE_NUM}p" "$file")
            if ! echo "$CONTEXT" | grep -q '@MainActor'; then
                PUBLISHED_VIOLATIONS=$((PUBLISHED_VIOLATIONS + 1))
                SHORT_FILE="${file#$PROJECT_DIR/}"
                fail "@Published class missing @MainActor: $SHORT_FILE:$LINE_NUM"
            fi
        done <<< "$CLASS_LINES"
    fi
done < <(find "$PROJECT_DIR/Shared" -name "*.swift" 2>/dev/null)

if [ "$PUBLISHED_VIOLATIONS" -eq 0 ]; then
    pass "All @Published ObservableObject classes are @MainActor"
fi

# =============================================================================
section "RULE 4: BLE — never clear connectedPeripheral on unexpected disconnect"
# =============================================================================
# In didDisconnectPeripheral, connectedPeripheral = nil must only appear in
# user-initiated or timeout paths, never in the shouldAutoReconnect branch.

BLE_FILE="$PROJECT_DIR/Packages/MeshCoreKit/Sources/MeshCoreKit/BLE/BLEManager.swift"
if [ -f "$BLE_FILE" ]; then
    # The iOS auto-reconnect path (shouldAutoReconnect == true) must:
    # 1. Call central.connect(peripheral) to queue reconnect
    # 2. NOT clear connectedPeripheral immediately
    # 3. Only clear connectedPeripheral in the timeout safety path (after 60s)
    #
    # Extract the reconnect block from didDisconnectPeripheral only (not didFailToConnect)
    IOS_RECONNECT_BLOCK=$(awk '/didDisconnectPeripheral/,/^    \}/' "$BLE_FILE" 2>/dev/null | awk '/if shouldAutoReconnect \{/,/\} else \{/' || true)

    # Count connectedPeripheral = nil inside timeout block (expected: 1)
    TIMEOUT_NILS=$(echo "$IOS_RECONNECT_BLOCK" | awk '/reconnect timeout/,/startScanning/' | grep -c 'connectedPeripheral = nil' 2>/dev/null || true)
    # Count total connectedPeripheral = nil in the reconnect block
    TOTAL_NILS=$(echo "$IOS_RECONNECT_BLOCK" | grep -c 'connectedPeripheral = nil' 2>/dev/null || true)

    # All nils should be accounted for by the timeout path
    if [ "$TOTAL_NILS" -eq "$TIMEOUT_NILS" ]; then
        pass "BLE: connectedPeripheral preserved during auto-reconnect (timeout safety only)"
    else
        OUTSIDE=$((TOTAL_NILS - TIMEOUT_NILS))
        fail "BLE: $OUTSIDE connectedPeripheral = nil outside timeout path in auto-reconnect block"
    fi

    # Also verify that central.connect is called in the reconnect path
    if echo "$IOS_RECONNECT_BLOCK" | grep -q 'central.connect(peripheral'; then
        pass "BLE: central.connect(peripheral) called for auto-reconnect"
    else
        fail "BLE: missing central.connect(peripheral) in auto-reconnect path"
    fi
else
    warn "BLEManager.swift not found — skipping BLE check"
fi

# =============================================================================
section "RULE 7: All uint32 protocol values are Little Endian"
# =============================================================================
# Check for bigEndian usage in protocol files (should not exist)

PROTOCOL_DIR="$PROJECT_DIR/Packages/MeshCoreKit/Sources/MeshCoreKit/Protocol"
if [ -d "$PROTOCOL_DIR" ]; then
    BIG_ENDIAN_HITS=$(grep -rn 'bigEndian' "$PROTOCOL_DIR" 2>/dev/null || true)
    if [ -z "$BIG_ENDIAN_HITS" ]; then
        pass "No bigEndian usage in protocol code"
    else
        fail "bigEndian found in protocol code (should be littleEndian):"
        echo "$BIG_ENDIAN_HITS" | while IFS= read -r line; do echo "    $line"; done
    fi
else
    warn "Protocol directory not found"
fi

# =============================================================================
section "RULE 8: Channel PSK is 16 bytes, not 32"
# =============================================================================
# Check that channel secret/PSK handling uses 16 bytes

PSK_32=$(grep -rn 'secret.*32\|psk.*32\|PSK.*32' "$PROJECT_DIR/Shared" "$PROJECT_DIR/Packages" --include="*.swift" 2>/dev/null | grep -iv 'pubkey\|publicKey\|pub_key\|name.*32\|advName.*32' || true)
if [ -z "$PSK_32" ]; then
    pass "No suspicious 32-byte PSK/secret references found"
else
    warn "Possible 32-byte PSK references (verify these are not channel secrets):"
    echo "$PSK_32" | while IFS= read -r line; do echo "    $line"; done
fi

# =============================================================================
section "RULE 13: CMD_DEVICE_QUERY app_target_ver >= 3"
# =============================================================================
# Check that device query sends version >= 3

QUERY_FILE=$(grep -rln 'buildDeviceQuery\|CMD_DEVICE_QUERY\|deviceQuery' "$PROTOCOL_DIR" 2>/dev/null | head -1 || true)
if [ -n "$QUERY_FILE" ]; then
    # Look for the version byte in the device query builder
    VER_LINE=$(grep -n 'app_target_ver\|0x03\|version.*3\|append.*3' "$QUERY_FILE" 2>/dev/null | head -5 || true)
    if echo "$VER_LINE" | grep -q '0x03\|\.03\| 3'; then
        pass "CMD_DEVICE_QUERY sends app_target_ver >= 3"
    else
        warn "Could not confirm app_target_ver >= 3 in device query — verify manually"
    fi
else
    warn "Device query builder not found — skipping version check"
fi

# =============================================================================
section "PRINCIPLE 1: Everything visible is interactive"
# =============================================================================
# Check that Text views showing data have nearby tap/long-press gestures
# (Heuristic: warn about standalone Text with data but no .onTapGesture nearby)

# This is hard to verify statically — check for common anti-patterns instead
PLAIN_DATA_TEXT=$(grep -rn 'Text(.*\.name\|Text(.*\.text\|Text(.*\.address' "$PROJECT_DIR/Shared/Views" --include="*.swift" 2>/dev/null | grep -v 'Button\|NavigationLink\|onTapGesture\|contextMenu\|Label' | head -5 || true)
if [ -z "$PLAIN_DATA_TEXT" ]; then
    pass "No obvious non-interactive data Text views found"
else
    warn "Potential non-interactive data displays (verify they have gestures):"
    echo "$PLAIN_DATA_TEXT" | while IFS= read -r line; do
        SHORT="${line#$PROJECT_DIR/}"
        echo "    $SHORT"
    done
fi

# =============================================================================
section "PRINCIPLE 2: One source of truth for every setting"
# =============================================================================
# Check for duplicate UserDefaults keys (same key read/written in multiple files)

DEFAULTS_KEYS=$(grep -roh 'forKey: "[^"]*"' "$PROJECT_DIR/Shared" --include="*.swift" 2>/dev/null | sort | uniq -d || true)
if [ -z "$DEFAULTS_KEYS" ]; then
    pass "No duplicate UserDefaults keys across files"
else
    # Filter: same key in multiple FILES is a potential violation
    REAL_DUPES=0
    while IFS= read -r key; do
        [ -z "$key" ] && continue
        KEY_VAL=$(echo "$key" | sed 's/forKey: "//;s/"//')
        FILE_COUNT=$(grep -rl "forKey: \"$KEY_VAL\"" "$PROJECT_DIR/Shared" --include="*.swift" 2>/dev/null | wc -l | tr -d ' ')
        if [ "$FILE_COUNT" -gt 1 ]; then
            # Multiple files touching the same key is expected for read+write patterns
            # Only flag if it's more than 2 files (likely duplication)
            if [ "$FILE_COUNT" -gt 2 ]; then
                REAL_DUPES=$((REAL_DUPES + 1))
                warn "UserDefaults key \"$KEY_VAL\" accessed from $FILE_COUNT files"
            fi
        fi
    done <<< "$DEFAULTS_KEYS"
    if [ "$REAL_DUPES" -eq 0 ]; then
        pass "UserDefaults keys have reasonable access patterns"
    fi
fi

# =============================================================================
section "PRINCIPLE 3: Every setting tells you what it does"
# =============================================================================
# Check that Toggle views have nearby help text (footer, .help, or Text description)
# Heuristic: Toggles should be within 5 lines of descriptive text or inside a Section with footer

TOGGLES_WITHOUT_HELP=0
while IFS= read -r file; do
    TOGGLE_LINES=$(grep -n 'Toggle(' "$file" 2>/dev/null || true)
    while IFS= read -r toggle; do
        [ -z "$toggle" ] && continue
        LINE_NUM=$(echo "$toggle" | cut -d: -f1)
        # Check 8 lines after for help text indicators
        END=$((LINE_NUM + 8))
        CONTEXT=$(sed -n "${LINE_NUM},${END}p" "$file")
        if ! echo "$CONTEXT" | grep -qi 'footer\|\.help\|Text("\|description\|Caption\|\.font(.caption'; then
            # Also check 5 lines before for Section header with footer
            START=$((LINE_NUM > 5 ? LINE_NUM - 5 : 1))
            BEFORE=$(sed -n "${START},${LINE_NUM}p" "$file")
            if ! echo "$BEFORE" | grep -qi 'Section\|header\|footer'; then
                TOGGLES_WITHOUT_HELP=$((TOGGLES_WITHOUT_HELP + 1))
                SHORT_FILE="${file#$PROJECT_DIR/}"
                if [ "$TOGGLES_WITHOUT_HELP" -le 5 ]; then
                    warn "Toggle possibly missing help text: $SHORT_FILE:$LINE_NUM"
                fi
            fi
        fi
    done <<< "$TOGGLE_LINES"
done < <(find "$PROJECT_DIR/Shared/Views" -name "*.swift" 2>/dev/null)

if [ "$TOGGLES_WITHOUT_HELP" -eq 0 ]; then
    pass "All Toggle controls appear to have nearby help text"
elif [ "$TOGGLES_WITHOUT_HELP" -gt 5 ]; then
    warn "... and $((TOGGLES_WITHOUT_HELP - 5)) more toggles without obvious help text"
fi

# =============================================================================
section "ARCHITECTURE: @Observable stores use @Environment (not @EnvironmentObject)"
# =============================================================================
# Views should use @Environment(Store.self), not @EnvironmentObject var viewModel

ENV_OBJ_VIOLATIONS=$(grep -rn '@EnvironmentObject.*viewModel\|@EnvironmentObject.*store' "$PROJECT_DIR/Shared/Views" --include="*.swift" 2>/dev/null || true)
if [ -z "$ENV_OBJ_VIOLATIONS" ]; then
    pass "No @EnvironmentObject viewModel/store usage in Views"
else
    fail "@EnvironmentObject found (should use @Environment(Store.self)):"
    echo "$ENV_OBJ_VIOLATIONS" | head -5 | while IFS= read -r line; do
        SHORT="${line#$PROJECT_DIR/}"
        echo "    $SHORT"
    done
fi

# =============================================================================
section "ARCHITECTURE: No .sheet on macOS/Catalyst for DeviceInfo"
# =============================================================================
# DeviceInfoSection should use .inspector on macOS, never .sheet on Catalyst

DEVICE_INFO_SHEET=$(grep -rn '\.sheet.*deviceInfo\|\.sheet.*DeviceInfo' "$PROJECT_DIR/Shared/Views" --include="*.swift" 2>/dev/null | grep -v '#if.*os(iOS)\|#if.*!os(macOS)\|targetEnvironment(macCatalyst)' | head -5 || true)
if [ -z "$DEVICE_INFO_SHEET" ]; then
    pass "No unconditional .sheet for DeviceInfo (Catalyst bounce bug avoided)"
else
    warn "Possible .sheet usage for DeviceInfo on macOS/Catalyst — verify platform guards:"
    echo "$DEVICE_INFO_SHEET" | while IFS= read -r line; do
        SHORT="${line#$PROJECT_DIR/}"
        echo "    $SHORT"
    done
fi

# =============================================================================
section "SAFETY: No secrets in committed files"
# =============================================================================
# Check for potential secrets/keys in Swift files

SECRET_PATTERNS='private_key\s*=\s*"\|api_key\s*=\s*"\|password\s*=\s*"\|secret\s*=\s*"[A-Za-z0-9]'
SECRETS_FOUND=$(grep -rn "$SECRET_PATTERNS" "$PROJECT_DIR/Shared" "$PROJECT_DIR/Packages" --include="*.swift" 2>/dev/null | grep -v 'Keychain\|forKey\|UserDefaults\|example\|placeholder\|""' | head -5 || true)
if [ -z "$SECRETS_FOUND" ]; then
    pass "No hardcoded secrets detected in Swift files"
else
    fail "Possible hardcoded secrets found:"
    echo "$SECRETS_FOUND" | while IFS= read -r line; do
        SHORT="${line#$PROJECT_DIR/}"
        echo "    $SHORT"
    done
fi

# =============================================================================
section "DEDUP: Message deduplication window"
# =============================================================================
# Verify the dedup window is reasonable (> 2s to handle mesh delays)

DEDUP_LINE=$(grep -n 'timeIntervalSince.*message.timestamp.*<' "$PROJECT_DIR/Shared/Stores/MessageStoreManager.swift" 2>/dev/null || true)
if [ -n "$DEDUP_LINE" ]; then
    WINDOW=$(echo "$DEDUP_LINE" | grep -o '< [0-9]*' | grep -o '[0-9]*')
    if [ -n "$WINDOW" ] && [ "$WINDOW" -ge 10 ]; then
        pass "Message dedup window is ${WINDOW}s (sufficient for mesh routing delays)"
    elif [ -n "$WINDOW" ]; then
        fail "Message dedup window is only ${WINDOW}s — too narrow for mesh multi-path delivery"
    else
        warn "Could not parse dedup window value"
    fi
else
    warn "Dedup window check not found in MessageStoreManager"
fi

# =============================================================================
section "ROUTING: Auto path reset on direct message"
# =============================================================================
# Verify the path auto-reset logic exists in response handling

PATH_RESET=$(grep -c 'PATH AUTO-RESET\|hops.*==.*0.*outPathLen.*>.*0' "$PROJECT_DIR/Shared/ViewModels/PommeCoreViewModel+ResponseHandling.swift" 2>/dev/null || true)
if [ "$PATH_RESET" -gt 0 ]; then
    pass "Auto path reset on incoming direct message is implemented"
else
    fail "Missing auto path reset when contact returns to direct range"
fi

# =============================================================================
# Summary
# =============================================================================

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if [ "$FAILURES" -eq 0 ]; then
    echo -e "${GREEN}✓ All $CHECKS checks passed${NC} ($WARNINGS advisory warnings)"
else
    echo -e "${RED}✗ $FAILURES of $CHECKS checks FAILED${NC} ($WARNINGS advisory warnings)"
fi
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

exit "$FAILURES"
