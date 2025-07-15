#!/bin/bash

# =============================================================================
# VibeTunnel Build Script
# =============================================================================
# 
# This script builds the VibeTunnel application using xcodebuild with optional
# code signing support. It includes comprehensive error checking and reports
# build details including the IS_PRERELEASE_BUILD flag status.
#
# USAGE:
#   ./scripts/build.sh [--configuration Debug|Release] [--sign]
#
# ARGUMENTS:
#   --configuration <Debug|Release>  Build configuration (default: Release)
#   --sign                          Sign the app after building (requires cert)
#
# ENVIRONMENT VARIABLES:
#   IS_PRERELEASE_BUILD=YES|NO      Sets pre-release flag in Info.plist
#   MACOS_SIGNING_CERTIFICATE_P12_BASE64  CI certificate for signing
#   USE_CUSTOM_DERIVED_DATA=YES     Force custom derived data (default: NO)
#                                   When NO, uses Xcode's default to preserve
#                                   Swift package resolution
#
# OUTPUTS:
#   - Built app at: build/Build/Products/<Configuration>/VibeTunnel.app
#   - Version and build number information
#   - IS_PRERELEASE_BUILD flag status verification
#
# DEPENDENCIES:
#   - Xcode and command line tools
#   - xcbeautify (optional, for prettier output)
#
# EXAMPLES:
#   ./scripts/build.sh                           # Release build
#   ./scripts/build.sh --configuration Debug     # Debug build
#   ./scripts/build.sh --sign                    # Release build with signing
#   IS_PRERELEASE_BUILD=YES ./scripts/build.sh   # Beta build
#
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAC_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$MAC_DIR")"
BUILD_DIR="$MAC_DIR/build"

# Default values
CONFIGURATION="Release"
SIGN_APP=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --configuration)
            CONFIGURATION="$2"
            shift 2
            ;;
        --sign)
            SIGN_APP=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--configuration Debug|Release] [--sign]"
            exit 1
            ;;
    esac
done

echo "Building VibeTunnel..."
echo "Configuration: $CONFIGURATION"
echo "Code signing: $SIGN_APP"
echo "Architecture: ARM64 only"

# Clean build directory only if it doesn't exist
mkdir -p "$BUILD_DIR"


# Bun server is built by Xcode build phase

# Build the app
cd "$MAC_DIR"

# Use CI-specific configuration if in CI environment
XCCONFIG_ARG=""
if [[ "${CI:-false}" == "true" ]] && [[ -f "$PROJECT_DIR/.xcode-ci-config.xcconfig" ]]; then
    echo "Using CI-specific build configuration"
    XCCONFIG_ARG="-xcconfig $PROJECT_DIR/.xcode-ci-config.xcconfig"
fi

# Build ARM64-only binary

# Use Xcode's default derived data path to preserve Swift package resolution
# Only use custom path if explicitly requested or in CI
if [[ "${CI:-false}" == "true" ]] || [[ "${USE_CUSTOM_DERIVED_DATA:-false}" == "true" ]]; then
    DERIVED_DATA_ARG="-derivedDataPath $BUILD_DIR"
    echo "Using custom derived data path: $BUILD_DIR"
else
    # Use default derived data, but still put build products in our build dir
    DERIVED_DATA_ARG=""
    echo "Using Xcode's default derived data path (preserves Swift packages)"
fi

# Prepare code signing arguments
CODE_SIGN_ARGS=""
if [[ "${CI:-false}" == "true" ]] || [[ "$SIGN_APP" == false ]]; then
    # In CI or when not signing, disable code signing entirely
    CODE_SIGN_ARGS="CODE_SIGN_IDENTITY=\"\" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO CODE_SIGN_ENTITLEMENTS=\"\" ENABLE_HARDENED_RUNTIME=NO PROVISIONING_PROFILE_SPECIFIER=\"\" DEVELOPMENT_TEAM=\"\""
fi

# Check if xcbeautify is available
if command -v xcbeautify &> /dev/null; then
    echo "🔨 Building ARM64-only binary with xcbeautify..."
    xcodebuild \
        -project VibeTunnel-Mac.xcodeproj \
        -scheme VibeTunnel-Mac \
        -configuration "$CONFIGURATION" \
        $DERIVED_DATA_ARG \
        -destination "platform=macOS,arch=arm64" \
        $XCCONFIG_ARG \
        ARCHS="arm64" \
        ONLY_ACTIVE_ARCH=NO \
        $CODE_SIGN_ARGS \
        build | xcbeautify
else
    echo "🔨 Building ARM64-only binary (install xcbeautify for cleaner output)..."
    xcodebuild \
        -project VibeTunnel-Mac.xcodeproj \
        -scheme VibeTunnel-Mac \
        -configuration "$CONFIGURATION" \
        $DERIVED_DATA_ARG \
        -destination "platform=macOS,arch=arm64" \
        $XCCONFIG_ARG \
        ARCHS="arm64" \
        ONLY_ACTIVE_ARCH=NO \
        $CODE_SIGN_ARGS \
        build
fi

# Find the app in the appropriate location
if [[ "${CI:-false}" == "true" ]] || [[ "${USE_CUSTOM_DERIVED_DATA:-false}" == "true" ]]; then
    APP_PATH="$BUILD_DIR/Build/Products/$CONFIGURATION/VibeTunnel.app"
else
    # When using default derived data, get the build product path from xcodebuild
    DEFAULT_DERIVED_DATA="$HOME/Library/Developer/Xcode/DerivedData"
    # Find the most recent VibeTunnel build (exclude Index.noindex)
    APP_PATH=$(find "$DEFAULT_DERIVED_DATA" -name "VibeTunnel.app" -path "*/Build/Products/$CONFIGURATION/*" ! -path "*/Index.noindex/*" 2>/dev/null | head -n 1)
    
    if [[ -z "$APP_PATH" ]]; then
        # Fallback: try to get from xcode-select
        BUILT_PRODUCTS_DIR=$(xcodebuild -project VibeTunnel-Mac.xcodeproj -scheme VibeTunnel-Mac -configuration "$CONFIGURATION" -showBuildSettings | grep "BUILT_PRODUCTS_DIR" | head -n 1 | awk '{print $3}')
        if [[ -n "$BUILT_PRODUCTS_DIR" ]]; then
            APP_PATH="$BUILT_PRODUCTS_DIR/VibeTunnel.app"
        fi
    fi
fi

if [[ ! -d "$APP_PATH" ]]; then
    echo "Error: Build failed - app not found"
    echo "Searched in: ${APP_PATH:-various locations}"
    exit 1
fi

echo "Found app at: $APP_PATH"

# Sparkle sandbox fix is no longer needed - we use default XPC services
# The fix-sparkle-sandbox.sh script now just verifies configuration
if [[ "$CONFIGURATION" == "Release" ]]; then
    if [ -x "$SCRIPT_DIR/fix-sparkle-sandbox.sh" ]; then
        echo "Verifying Sparkle configuration..."
        "$SCRIPT_DIR/fix-sparkle-sandbox.sh" "$APP_PATH"
    fi
fi

# Clean up unwanted files from the bundle
echo "Cleaning up unwanted files from bundle..."
rm -f "$APP_PATH/Contents/Resources/Local.xcconfig"
rm -rf "$APP_PATH/Contents/Resources/web/public/tests"
echo "✓ Removed development files from bundle"

# Sign the app if requested
if [[ "$SIGN_APP" == true ]]; then
    if [[ -n "${MACOS_SIGNING_CERTIFICATE_P12_BASE64:-}" ]]; then
        echo "Signing app with CI certificate..."
        "$SCRIPT_DIR/codesign-app.sh" "$APP_PATH"
    else
        echo "Warning: Signing requested but no certificate configured"
    fi
fi

echo "Build complete: $APP_PATH"

# Print version info
VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP_PATH/Contents/Info.plist")
BUILD=$(/usr/libexec/PlistBuddy -c "Print CFBundleVersion" "$APP_PATH/Contents/Info.plist")
echo "Version: $VERSION ($BUILD)"

# Verify version matches xcconfig
if [[ -f "$MAC_DIR/VibeTunnel/version.xcconfig" ]]; then
    EXPECTED_VERSION=$(grep 'MARKETING_VERSION' "$MAC_DIR/VibeTunnel/version.xcconfig" | sed 's/.*MARKETING_VERSION = //')
    EXPECTED_BUILD=$(grep 'CURRENT_PROJECT_VERSION' "$MAC_DIR/VibeTunnel/version.xcconfig" | sed 's/.*CURRENT_PROJECT_VERSION = //')
    
    if [[ "$VERSION" != "$EXPECTED_VERSION" ]]; then
        echo "⚠️  WARNING: Built version ($VERSION) doesn't match version.xcconfig ($EXPECTED_VERSION)"
        echo "   This may indicate the Xcode project is not properly configured to use version.xcconfig"
    else
        echo "✓ Version matches version.xcconfig"
    fi
    
    if [[ "$BUILD" != "$EXPECTED_BUILD" ]]; then
        echo "⚠️  WARNING: Built build number ($BUILD) doesn't match version.xcconfig ($EXPECTED_BUILD)"
        echo "   This may indicate the Xcode project is not properly configured to use version.xcconfig"
    else
        echo "✓ Build number matches version.xcconfig"
    fi
else
    echo "⚠️  WARNING: version.xcconfig not found - cannot verify version consistency"
fi

# Verify IS_PRERELEASE_BUILD flag
PRERELEASE_FLAG=$(/usr/libexec/PlistBuddy -c "Print IS_PRERELEASE_BUILD" "$APP_PATH/Contents/Info.plist" 2>/dev/null || echo "not found")
if [[ "$PRERELEASE_FLAG" != "not found" ]]; then
    if [[ "$PRERELEASE_FLAG" == "YES" ]]; then
        echo "✓ IS_PRERELEASE_BUILD: YES (pre-release build)"
    elif [[ "$PRERELEASE_FLAG" == "NO" ]]; then
        echo "✓ IS_PRERELEASE_BUILD: NO (stable build)"
    else
        echo "⚠ IS_PRERELEASE_BUILD: '$PRERELEASE_FLAG' (unexpected value)"
    fi
else
    echo "⚠ IS_PRERELEASE_BUILD: not set (will use version string fallback)"
fi