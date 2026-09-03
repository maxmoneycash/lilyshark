#!/bin/bash
# bump-build.sh — set or increment the build number across all targets
# Usage:
#   ./bump-build.sh          # auto-increment from current
#   ./bump-build.sh 50       # set to a specific number

PBXPROJ="PommeCore.xcodeproj/project.pbxproj"

CURRENT=$(grep -m1 "CURRENT_PROJECT_VERSION" "$PBXPROJ" | grep -o '[0-9]*' | head -1)

if [ -n "$1" ]; then
    NEW="$1"
else
    NEW=$((CURRENT + 1))
fi

sed -i '' "s/CURRENT_PROJECT_VERSION = $CURRENT;/CURRENT_PROJECT_VERSION = $NEW;/g" "$PBXPROJ"

echo "Build number: $CURRENT → $NEW"
