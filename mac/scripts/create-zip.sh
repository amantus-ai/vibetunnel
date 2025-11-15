#!/bin/bash

# =============================================================================
# VibeTunnel ZIP Creation Script
# =============================================================================
#
# This script creates a ZIP archive for VibeTunnel distribution.
#
# USAGE:
#   ./scripts/create-zip.sh <app_path> [output_path]
#
# ARGUMENTS:
#   app_path      Path to the .app bundle
#   output_path   Path for output ZIP (optional, defaults to build/VibeTunnel-<version>-<arch>.zip)
#
# NOTE:
#   The architecture suffix is automatically detected from the app bundle binary using lipo.
#   Supported architectures: arm64, x86_64, universal (both)
#
# =============================================================================

set -euo pipefail

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$SCRIPT_DIR/common.sh" ]] && source "$SCRIPT_DIR/common.sh"

if [[ $# -lt 1 ]] || [[ $# -gt 2 ]]; then
    echo "Usage: $0 <app_path> [output_path]"
    exit 1
fi

APP_PATH="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAC_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$MAC_DIR")"
BUILD_DIR="$MAC_DIR/build"

if [[ ! -d "$APP_PATH" ]]; then
    echo "Error: App not found at $APP_PATH"
    exit 1
fi

# Get app name and version info
APP_NAME=$(/usr/libexec/PlistBuddy -c "Print CFBundleName" "$APP_PATH/Contents/Info.plist" 2>/dev/null || echo "VibeTunnel")
VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP_PATH/Contents/Info.plist")

# Detect architecture from the app bundle binary
EXECUTABLE_NAME=$(/usr/libexec/PlistBuddy -c "Print CFBundleExecutable" "$APP_PATH/Contents/Info.plist" 2>/dev/null || echo "VibeTunnel")
ARCHS=$(lipo -archs "$APP_PATH/Contents/MacOS/$EXECUTABLE_NAME" 2>/dev/null || echo "")

# Determine architecture suffix for filename
ARCH_SUFFIX=""
if [[ "$ARCHS" == "arm64" ]]; then
    ARCH_SUFFIX="-arm64"
elif [[ "$ARCHS" == "x86_64" ]]; then
    ARCH_SUFFIX="-x86_64"
elif [[ "$ARCHS" == *"arm64"* ]] && [[ "$ARCHS" == *"x86_64"* ]]; then
    ARCH_SUFFIX="-universal"
fi

ZIP_NAME="${APP_NAME}-${VERSION}${ARCH_SUFFIX}.zip"

# Use provided output path or default
if [[ $# -eq 2 ]]; then
    ZIP_PATH="$2"
else
    ZIP_PATH="$BUILD_DIR/$ZIP_NAME"
fi

echo "Creating ZIP: $ZIP_NAME"

# Create temporary directory for ZIP contents
ZIP_TEMP="$BUILD_DIR/zip-temp"
rm -rf "$ZIP_TEMP"
mkdir -p "$ZIP_TEMP"

# Copy app to temporary directory
cp -R "$APP_PATH" "$ZIP_TEMP/"

# Create ZIP using ditto (preserves extended attributes and permissions)
cd "$ZIP_TEMP"
ditto -c -k --sequesterRsrc --keepParent "$(basename "$APP_PATH")" "$ZIP_PATH"

# Clean up
cd - > /dev/null
rm -rf "$ZIP_TEMP"

# Verify ZIP
echo "Verifying ZIP..."
unzip -t "$ZIP_PATH" > /dev/null

echo "ZIP created successfully: $ZIP_PATH"

# Show file size
FILE_SIZE=$(ls -lh "$ZIP_PATH" | awk '{print $5}')
echo "File size: $FILE_SIZE"