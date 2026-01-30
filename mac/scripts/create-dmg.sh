#!/bin/bash

# =============================================================================
# VibeTunnel DMG Creation Script
# =============================================================================
#
# This script creates a DMG disk image for VibeTunnel distribution.
#
# USAGE:
#   ./scripts/create-dmg.sh <app_path> [output_path]
#
# ARGUMENTS:
#   app_path      Path to the .app bundle
#   output_path   Path for output DMG (optional, defaults to build/VibeTunnel-<version>-<arch>.dmg)
#
# NOTE:
#   The architecture suffix is automatically detected from the app bundle binary using lipo.
#   Supported architectures: arm64, x86_64, universal (both)
#
# ENVIRONMENT VARIABLES:
#   DMG_VOLUME_NAME   Name for the DMG volume (optional, defaults to app name)
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

DMG_NAME="${APP_NAME}-${VERSION}${ARCH_SUFFIX}.dmg"
DMG_VOLUME_NAME="${DMG_VOLUME_NAME:-$APP_NAME}"

# Use provided output path or default
if [[ $# -eq 2 ]]; then
    DMG_PATH="$2"
else
    DMG_PATH="$BUILD_DIR/$DMG_NAME"
fi

echo "Creating DMG: $DMG_NAME"

# Clean up any stuck VibeTunnel volumes before starting
echo "Checking for stuck DMG volumes..."
for volume in /Volumes/VibeTunnel* "/Volumes/$DMG_VOLUME_NAME"*; do
    if [ -d "$volume" ]; then
        echo "  Unmounting stuck volume: $volume"
        hdiutil detach "$volume" -force 2>/dev/null || true
        sleep 1
    fi
done

# Also check for any DMG processes that might be stuck
if pgrep -f "VibeTunnel.*\.dmg" > /dev/null; then
    echo "  Found stuck DMG processes, killing them..."
    pkill -f "VibeTunnel.*\.dmg" || true
    sleep 2
fi

# Create temporary directory for DMG contents
DMG_TEMP="$BUILD_DIR/dmg-temp"
rm -rf "$DMG_TEMP"
mkdir -p "$DMG_TEMP"

# Copy app to temporary directory
cp -R "$APP_PATH" "$DMG_TEMP/"

# Create symbolic link to Applications folder
ln -s /Applications "$DMG_TEMP/Applications"

# Create initial DMG as read-write
DMG_RW_PATH="${DMG_PATH%.dmg}-rw.dmg"
hdiutil create \
    -volname "$DMG_VOLUME_NAME" \
    -srcfolder "$DMG_TEMP" \
    -ov \
    -format UDRW \
    -size 200m \
    "$DMG_RW_PATH"

# Clean up temp folder
rm -rf "$DMG_TEMP"

echo "Applying custom styling to DMG..."

# Mount the DMG
MOUNT_POINT="/Volumes/$DMG_VOLUME_NAME"
# Ensure the mount point doesn't exist before mounting
if [ -d "$MOUNT_POINT" ]; then
    echo "Mount point already exists, attempting to unmount..."
    hdiutil detach "$MOUNT_POINT" -force 2>/dev/null || true
    sleep 2
fi
hdiutil attach "$DMG_RW_PATH" -mountpoint "$MOUNT_POINT" -nobrowse


# Copy background image
mkdir -p "$MOUNT_POINT/.background"
cp "$PROJECT_DIR/assets/dmg-background-small.png" "$MOUNT_POINT/.background/background.png"

# Set custom volume icon
if [[ -f "$PROJECT_DIR/assets/appicon-512.png" ]]; then
    # Convert PNG to ICNS for volume icon
    sips -s format icns "$PROJECT_DIR/assets/appicon-512.png" --out "$MOUNT_POINT/.VolumeIcon.icns" >/dev/null 2>&1
    SetFile -a C "$MOUNT_POINT" 2>/dev/null || true
fi

# Apply window styling with AppleScript
osascript <<EOF
tell application "Finder"
    tell disk "$DMG_VOLUME_NAME"
        open
        
        -- Get the window
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        
        -- Set window bounds (centered, 500x320)
        set the bounds of container window to {400, 100, 900, 420}
        
        -- Configure icon view options
        set viewOptions to the icon view options of container window
        set arrangement of viewOptions to not arranged
        set icon size of viewOptions to 128
        
        -- Set background
        set background picture of viewOptions to file ".background:background.png"
        
        -- Set text color to white
        set text size of viewOptions to 12
        set label position of viewOptions to bottom
        
        -- Position items
        set position of item "VibeTunnel.app" of container window to {125, 160}
        set position of item "Applications" of container window to {375, 160}
        
        -- Set extended attributes for better appearance
        set shows item info of viewOptions to false
        set shows icon preview of viewOptions to true
        
        
        -- Update without registering applications
        update without registering applications
        delay 2
        
        -- Close and reopen to ensure settings stick
        close
        open
        delay 1
    end tell
end tell
EOF

# Give Finder time to update
sleep 3

# Force close Finder window to ensure settings are saved
osascript -e 'tell application "Finder" to close every window'


# Unmount with retry and force
echo "Unmounting DMG..."
for i in {1..5}; do
    if hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null; then
        break
    fi
    echo "  Retry $i/5..."
    if [ $i -eq 3 ]; then
        echo "  Attempting force unmount..."
        hdiutil detach "$MOUNT_POINT" -force 2>/dev/null || true
    fi
    sleep 2
done

# Final check - if still mounted, force unmount
if [ -d "$MOUNT_POINT" ]; then
    echo "  Volume still mounted, force unmounting..."
    hdiutil detach "$MOUNT_POINT" -force 2>/dev/null || true
    sleep 1
fi

# Convert to compressed read-only DMG
echo "Converting to final DMG format..."
hdiutil convert "$DMG_RW_PATH" -format ULMO -o "$DMG_PATH" -ov

# Clean up
rm -f "$DMG_RW_PATH"

# === EXTENSIVE ENVIRONMENT DEBUGGING ===
echo "=== Environment Debug Information ==="
echo "Current working directory: $(pwd)"
echo "User: $(whoami)"
echo "Date: $(date)"
echo "Environment variables related to signing:"
echo "  KEYCHAIN_NAME=${KEYCHAIN_NAME:-<not set>}"
echo "  SIGN_IDENTITY=${SIGN_IDENTITY:-<not set>}"
echo "  RUNNER_TEMP=${RUNNER_TEMP:-<not set>}"
echo "  GITHUB_ACTIONS=${GITHUB_ACTIONS:-<not set>}"
echo "  CI=${CI:-<not set>}"

# Check if secrets are available (without exposing their values)
echo "GitHub Secrets Status:"
echo "  APP_STORE_CONNECT_API_KEY_P8: ${APP_STORE_CONNECT_API_KEY_P8:+SET}" 
echo "  APP_STORE_CONNECT_ISSUER_ID: ${APP_STORE_CONNECT_ISSUER_ID:+SET}"
echo "  APP_STORE_CONNECT_KEY_ID: ${APP_STORE_CONNECT_KEY_ID:+SET}"
echo "  MACOS_SIGNING_CERTIFICATE_P12_BASE64: ${MACOS_SIGNING_CERTIFICATE_P12_BASE64:+SET}"
echo "  MACOS_SIGNING_CERTIFICATE_PASSWORD: ${MACOS_SIGNING_CERTIFICATE_PASSWORD:+SET}"

# List all keychains
echo "=== Keychain Information ==="
echo "Available keychains:"
security list-keychains -d user || echo "Failed to list user keychains"
security list-keychains -d system || echo "Failed to list system keychains"

echo ""
echo "Default keychain:"
security default-keychain -d user || echo "Failed to get default user keychain"

# Check if specific keychain exists
if [ -n "${KEYCHAIN_NAME:-}" ]; then
    echo ""
    echo "Checking for specified keychain: $KEYCHAIN_NAME"
    if security list-keychains -d user | grep -q "$KEYCHAIN_NAME"; then
        echo "✅ Keychain $KEYCHAIN_NAME found in user domain"
    else
        echo "❌ Keychain $KEYCHAIN_NAME NOT found in user domain"
    fi
    
    # Try to unlock the keychain if it exists
    if [ -f "$KEYCHAIN_NAME" ]; then
        echo "Keychain file exists at: $KEYCHAIN_NAME"
        echo "Checking keychain lock status..."
        security show-keychain-info "$KEYCHAIN_NAME" 2>&1 || echo "Cannot get keychain info"
    else
        echo "Keychain file does not exist at: $KEYCHAIN_NAME"
    fi
fi

# === SIGNING IDENTITY ANALYSIS ===
echo ""
echo "=== Signing Identity Analysis ==="

# Sign the DMG if signing credentials are available
if command -v codesign &> /dev/null; then
    echo "✅ codesign command is available"
    
    # Use the same signing identity as the app signing process
    SIGN_IDENTITY="${SIGN_IDENTITY:-Developer ID Application}"
    echo "Target signing identity: '$SIGN_IDENTITY'"
    
    # Check if we're in CI and have a specific keychain
    KEYCHAIN_OPTS=""
    if [ -n "${KEYCHAIN_NAME:-}" ]; then
        echo "Using keychain: $KEYCHAIN_NAME"
        KEYCHAIN_OPTS="--keychain $KEYCHAIN_NAME"
    else
        echo "No specific keychain specified, using default"
    fi
    
    # Try to find a valid signing identity
    IDENTITY_CHECK_CMD="security find-identity -v -p codesigning"
    if [ -n "${KEYCHAIN_NAME:-}" ]; then
        IDENTITY_CHECK_CMD="$IDENTITY_CHECK_CMD $KEYCHAIN_NAME"
        echo "Full identity check command: $IDENTITY_CHECK_CMD"
    fi
    
    echo ""
    echo "=== Full Identity Check Output ==="
    echo "Running: $IDENTITY_CHECK_CMD"
    IDENTITY_OUTPUT=$($IDENTITY_CHECK_CMD 2>&1) || true
    echo "Raw output:"
    echo "$IDENTITY_OUTPUT"
    echo "=== End Identity Check Output ==="
    
    # Count valid identities
    VALID_COUNT=$(echo "$IDENTITY_OUTPUT" | grep -c "valid identities found" || echo "0")
    echo "Valid identities found: $VALID_COUNT"
    
    # Check if any signing identity is available
    if echo "$IDENTITY_OUTPUT" | grep -q "valid identities found" && ! echo "$IDENTITY_OUTPUT" | grep -q "0 valid identities found"; then
        echo "✅ At least one valid signing identity found"
        
        # Show all identities
        echo "All available identities:"
        echo "$IDENTITY_OUTPUT" | grep -E "^\s*[0-9]+\)"
        
        # Check if our specific identity exists
        if echo "$IDENTITY_OUTPUT" | grep -q "$SIGN_IDENTITY"; then
            echo "✅ Found specific identity: $SIGN_IDENTITY"
            echo "Attempting to sign DMG with identity: $SIGN_IDENTITY"
            echo "Command: codesign --force --sign \"$SIGN_IDENTITY\" $KEYCHAIN_OPTS \"$DMG_PATH\""
            if codesign --force --sign "$SIGN_IDENTITY" $KEYCHAIN_OPTS "$DMG_PATH"; then
                echo "✅ DMG signing successful"
            else
                echo "❌ DMG signing failed"
                exit 1
            fi
        else
            echo "❌ Specific identity '$SIGN_IDENTITY' not found"
            
            # Try to use the first available Developer ID Application identity
            echo "Searching for any Developer ID Application identity..."
            AVAILABLE_IDENTITY=$(echo "$IDENTITY_OUTPUT" | grep "Developer ID Application" | head -1 | sed -E 's/.*"([^"]+)".*/\1/' || echo "")
            if [ -n "$AVAILABLE_IDENTITY" ]; then
                echo "✅ Found alternative identity: $AVAILABLE_IDENTITY"
                echo "Command: codesign --force --sign \"$AVAILABLE_IDENTITY\" $KEYCHAIN_OPTS \"$DMG_PATH\""
                if codesign --force --sign "$AVAILABLE_IDENTITY" $KEYCHAIN_OPTS "$DMG_PATH"; then
                    echo "✅ DMG signing successful with alternative identity"
                else
                    echo "❌ DMG signing failed with alternative identity"
                    exit 1
                fi
            else
                echo "❌ No Developer ID Application identity found"
                echo "⚠️ DMG will not be signed"
            fi
        fi
    else
        echo "❌ No valid signing identities available"
        echo "⚠️ DMG will not be signed"
        echo "This is expected for PR builds where certificates are not imported"
    fi
else
    echo "❌ codesign command not available"
    echo "⚠️ DMG will not be signed"
fi

echo "=== End Environment Debug Information ==="

# Verify DMG
echo "Verifying DMG..."
hdiutil verify "$DMG_PATH"

echo "DMG created successfully: $DMG_PATH"