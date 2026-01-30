#!/bin/bash
#
# Extract build number from a VibeTunnel DMG file
#
# This script mounts a DMG, extracts the CFBundleVersion from the app's Info.plist,
# and returns the build number for use in Sparkle appcast generation.

set -euo pipefail

if [ $# -ne 1 ]; then
    echo "Usage: $0 <path-to-dmg>"
    exit 1
fi

DMG_PATH="$1"

if [ ! -f "$DMG_PATH" ]; then
    echo "Error: DMG file not found: $DMG_PATH" >&2
    exit 1
fi

# Create temporary directory for mounting
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Mount the DMG
MOUNT_POINT="$TEMP_DIR/mount"
mkdir -p "$MOUNT_POINT"

if ! hdiutil attach "$DMG_PATH" -mountpoint "$MOUNT_POINT" -nobrowse -readonly -quiet 2>/dev/null; then
    echo "Error: Failed to mount DMG" >&2
    exit 1
fi

# Ensure we unmount on exit
trap "hdiutil detach '$MOUNT_POINT' -quiet 2>/dev/null || true; rm -rf $TEMP_DIR" EXIT

# Find the app bundle
APP_BUNDLE=$(find "$MOUNT_POINT" -name "*.app" -type d | head -1)

if [ -z "$APP_BUNDLE" ]; then
    echo "Error: No .app bundle found in DMG" >&2
    exit 1
fi

# Extract build number from Info.plist
INFO_PLIST="$APP_BUNDLE/Contents/Info.plist"

if [ ! -f "$INFO_PLIST" ]; then
    echo "Error: Info.plist not found in app bundle" >&2
    exit 1
fi

# Extract CFBundleVersion using plutil
BUILD_NUMBER=$(plutil -extract CFBundleVersion raw "$INFO_PLIST" 2>/dev/null || echo "")

if [ -z "$BUILD_NUMBER" ]; then
    echo "Error: Could not extract CFBundleVersion from Info.plist" >&2
    exit 1
fi

# Validate that it's a number
if ! [[ "$BUILD_NUMBER" =~ ^[0-9]+$ ]]; then
    echo "Error: Build number is not numeric: $BUILD_NUMBER" >&2
    exit 1
fi

echo "$BUILD_NUMBER"