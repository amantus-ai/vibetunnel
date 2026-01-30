#!/bin/bash

# App Verification Script for VibeTunnel
# Comprehensive verification of built app, DMG, entitlements, and notarization
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Usage
if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <app-path-or-dmg>"
    echo ""
    echo "Verifies app bundle or DMG for:"
    echo "  - Code signing"
    echo "  - Notarization"
    echo "  - Entitlements"
    echo "  - Sparkle XPC services"
    echo "  - Build numbers"
    exit 1
fi

TARGET="$1"
TEMP_MOUNT=""
APP_PATH=""

# Function to cleanup
cleanup() {
    if [[ -n "$TEMP_MOUNT" ]] && [[ -d "$TEMP_MOUNT" ]]; then
        echo "🧹 Cleaning up..."
        hdiutil detach "$TEMP_MOUNT" -quiet 2>/dev/null || true
    fi
}
trap cleanup EXIT

echo "🔍 VibeTunnel App Verification"
echo "=============================="
echo ""

# Handle DMG or App bundle
if [[ "$TARGET" == *.dmg ]]; then
    echo "📀 Mounting DMG: $TARGET"
    TEMP_MOUNT=$(hdiutil attach "$TARGET" -quiet -nobrowse | grep -E '^\s*/Volumes/' | tail -1 | awk '{print $NF}')
    APP_PATH="$TEMP_MOUNT/VibeTunnel.app"
    
    if [[ ! -d "$APP_PATH" ]]; then
        echo -e "${RED}❌ VibeTunnel.app not found in DMG${NC}"
        exit 1
    fi
else
    APP_PATH="$TARGET"
fi

if [[ ! -d "$APP_PATH" ]]; then
    echo -e "${RED}❌ App bundle not found at: $APP_PATH${NC}"
    exit 1
fi

echo "📱 Checking app: $APP_PATH"
echo ""

# 1. Basic Info
echo "📌 Basic Information:"
BUNDLE_ID=$(defaults read "$APP_PATH/Contents/Info.plist" CFBundleIdentifier 2>/dev/null || echo "unknown")
VERSION=$(defaults read "$APP_PATH/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo "unknown")
BUILD=$(defaults read "$APP_PATH/Contents/Info.plist" CFBundleVersion 2>/dev/null || echo "unknown")

echo "   Bundle ID: $BUNDLE_ID"
echo "   Version: $VERSION"
echo "   Build: $BUILD"
echo ""

# 2. Code Signing
echo "📌 Code Signing:"
if codesign -dv "$APP_PATH" 2>&1 | grep -q "Signature=adhoc"; then
    echo -e "${YELLOW}   ⚠️  App is ad-hoc signed (development)${NC}"
elif codesign -dv "$APP_PATH" 2>&1 | grep -q "Authority=Developer ID Application"; then
    echo -e "${GREEN}   ✅ App is signed with Developer ID${NC}"
    SIGNING_ID=$(codesign -dv "$APP_PATH" 2>&1 | grep "Authority=Developer ID Application" | head -1 | cut -d: -f2- | xargs)
    echo "   Certificate: $SIGNING_ID"
else
    echo -e "${RED}   ❌ App signing status unknown${NC}"
fi

# Verify signature
if codesign --verify --deep --strict "$APP_PATH" 2>/dev/null; then
    echo -e "${GREEN}   ✅ Code signature is valid${NC}"
else
    echo -e "${RED}   ❌ Code signature verification failed${NC}"
    codesign --verify --deep --strict "$APP_PATH" 2>&1 | grep -v "^$" | sed 's/^/      /'
fi
echo ""

# 3. Notarization
echo "📌 Notarization Status:"
if spctl --assess --type execute "$APP_PATH" 2>&1 | grep -q "accepted"; then
    echo -e "${GREEN}   ✅ App is notarized and accepted by Gatekeeper${NC}"
else
    SPCTL_OUTPUT=$(spctl --assess --type execute "$APP_PATH" 2>&1)
    if echo "$SPCTL_OUTPUT" | grep -q "rejected"; then
        echo -e "${RED}   ❌ App is rejected by Gatekeeper${NC}"
        echo "   $SPCTL_OUTPUT"
    else
        echo -e "${YELLOW}   ⚠️  Notarization status unclear${NC}"
        echo "   $SPCTL_OUTPUT"
    fi
fi

# Check notarization ticket
if codesign -dv "$APP_PATH" 2>&1 | grep -q "Notarization Ticket="; then
    echo -e "${GREEN}   ✅ Notarization ticket is stapled${NC}"
else
    echo -e "${YELLOW}   ⚠️  No notarization ticket found (may still be notarized)${NC}"
fi
echo ""

# 4. Entitlements
echo "📌 Entitlements:"
ENTITLEMENTS=$(codesign -d --entitlements :- "$APP_PATH" 2>/dev/null | plutil -p - 2>/dev/null || echo "Failed to extract")

# Check specific entitlements
if echo "$ENTITLEMENTS" | grep -q '"com.apple.security.app-sandbox" => 1'; then
    echo -e "${GREEN}   ✅ App sandbox is ENABLED${NC}"
else
    echo -e "${YELLOW}   ⚠️  App sandbox is DISABLED${NC}"
fi

if echo "$ENTITLEMENTS" | grep -q '"com.apple.security.network.client" => 1'; then
    echo -e "${GREEN}   ✅ Network client access enabled${NC}"
else
    echo -e "${RED}   ❌ Network client access not enabled${NC}"
fi

if echo "$ENTITLEMENTS" | grep -q '"com.apple.security.files.downloads.read-write" => 1'; then
    echo -e "${GREEN}   ✅ Downloads folder access enabled${NC}"
else
    echo -e "${YELLOW}   ⚠️  Downloads folder access not enabled${NC}"
fi

# Show all entitlements
echo "   All entitlements:"
echo "$ENTITLEMENTS" | grep -E "=>" | sed 's/^/      /' || echo "      None found"
echo ""

# 5. Sparkle Framework and XPC Services
echo "📌 Sparkle Framework:"
SPARKLE_PATH="$APP_PATH/Contents/Frameworks/Sparkle.framework"
if [[ -d "$SPARKLE_PATH" ]]; then
    echo -e "${GREEN}   ✅ Sparkle framework found${NC}"
    
    # Check XPC services
    echo "   XPC Services:"
    for XPC in "$SPARKLE_PATH/Versions/B/XPCServices"/*.xpc; do
        if [[ -d "$XPC" ]]; then
            XPC_NAME=$(basename "$XPC")
            echo "      Checking $XPC_NAME..."
            
            # Check if signed
            if codesign --verify "$XPC" 2>/dev/null; then
                echo -e "${GREEN}      ✅ $XPC_NAME is signed${NC}"
            else
                echo -e "${RED}      ❌ $XPC_NAME signature invalid${NC}"
            fi
            
            # Check entitlements
            XPC_ENTITLEMENTS=$(codesign -d --entitlements :- "$XPC" 2>/dev/null | plutil -p - 2>/dev/null || echo "")
            if echo "$XPC_ENTITLEMENTS" | grep -q '"com.apple.security.network.client" => 1'; then
                echo -e "${GREEN}      ✅ Network access enabled for $XPC_NAME${NC}"
            else
                echo -e "${RED}      ❌ Network access NOT enabled for $XPC_NAME${NC}"
            fi
        fi
    done
else
    echo -e "${RED}   ❌ Sparkle framework not found${NC}"
fi
echo ""

# 6. Build Number Validation Against Appcast
echo "📌 Appcast Validation:"
if [[ -f "$PROJECT_ROOT/appcast.xml" ]] || [[ -f "$PROJECT_ROOT/appcast-prerelease.xml" ]]; then
    EXISTING_BUILDS=""
    
    if [[ -f "$PROJECT_ROOT/appcast.xml" ]]; then
        EXISTING_BUILDS+=$(grep -E '<sparkle:version>[0-9]+</sparkle:version>' "$PROJECT_ROOT/appcast.xml" 2>/dev/null | sed 's/.*<sparkle:version>\([0-9]*\)<\/sparkle:version>.*/\1/' | tr '\n' ' ')
    fi
    
    if [[ -f "$PROJECT_ROOT/appcast-prerelease.xml" ]]; then
        EXISTING_BUILDS+=$(grep -E '<sparkle:version>[0-9]+</sparkle:version>' "$PROJECT_ROOT/appcast-prerelease.xml" 2>/dev/null | sed 's/.*<sparkle:version>\([0-9]*\)<\/sparkle:version>.*/\1/' | tr '\n' ' ')
    fi
    
    # Check for duplicate
    BUILD_FOUND=false
    for EXISTING in $EXISTING_BUILDS; do
        if [[ "$BUILD" == "$EXISTING" ]]; then
            BUILD_FOUND=true
            break
        fi
    done
    
    if [[ "$BUILD_FOUND" == "true" ]]; then
        echo -e "${YELLOW}   ⚠️  Build $BUILD already exists in appcast${NC}"
    else
        echo -e "${GREEN}   ✅ Build $BUILD is unique${NC}"
    fi
    
    # Find highest build
    HIGHEST=0
    for EXISTING in $EXISTING_BUILDS; do
        if [[ "$EXISTING" -gt "$HIGHEST" ]]; then
            HIGHEST=$EXISTING
        fi
    done
    
    if [[ "$BUILD" -gt "$HIGHEST" ]]; then
        echo -e "${GREEN}   ✅ Build $BUILD is higher than existing ($HIGHEST)${NC}"
    else
        echo -e "${RED}   ❌ Build $BUILD is not higher than existing ($HIGHEST)${NC}"
    fi
else
    echo "   No appcast files found for validation"
fi
echo ""

# 7. Sparkle Public Key
echo "📌 Sparkle Configuration:"
PUBLIC_KEY=$(defaults read "$APP_PATH/Contents/Info.plist" SUPublicEDKey 2>/dev/null || echo "")
if [[ -n "$PUBLIC_KEY" ]]; then
    echo -e "${GREEN}   ✅ Sparkle public key configured${NC}"
    echo "   Key: ${PUBLIC_KEY:0:20}..."
else
    echo -e "${RED}   ❌ No Sparkle public key found${NC}"
fi

FEED_URL=$(defaults read "$APP_PATH/Contents/Info.plist" SUFeedURL 2>/dev/null || echo "")
if [[ -n "$FEED_URL" ]]; then
    echo "   Feed URL: $FEED_URL"
fi
echo ""

# 8. Summary
echo "📊 Verification Summary:"
echo "========================"

ISSUES=0

# Check critical items
if ! codesign --verify --deep --strict "$APP_PATH" 2>/dev/null; then
    echo -e "${RED}❌ Code signature invalid${NC}"
    ((ISSUES++))
fi

if ! spctl --assess --type execute "$APP_PATH" 2>&1 | grep -q "accepted"; then
    echo -e "${RED}❌ Not accepted by Gatekeeper${NC}"
    ((ISSUES++))
fi

if ! echo "$ENTITLEMENTS" | grep -q '"com.apple.security.network.client" => 1'; then
    echo -e "${RED}❌ Missing network entitlement${NC}"
    ((ISSUES++))
fi

# Check XPC services have network access
if [[ -d "$SPARKLE_PATH/Versions/B/XPCServices/Downloader.xpc" ]]; then
    XPC_NET=$(codesign -d --entitlements :- "$SPARKLE_PATH/Versions/B/XPCServices/Downloader.xpc" 2>/dev/null | plutil -p - 2>/dev/null || echo "")
    if ! echo "$XPC_NET" | grep -q '"com.apple.security.network.client" => 1'; then
        echo -e "${RED}❌ Sparkle Downloader.xpc missing network entitlement${NC}"
        ((ISSUES++))
    fi
fi

if [[ $ISSUES -eq 0 ]]; then
    echo -e "${GREEN}✅ All critical checks passed!${NC}"
    echo ""
    echo "This app is ready for distribution."
else
    echo -e "${RED}❌ Found $ISSUES critical issues${NC}"
    echo ""
    echo "Please fix these issues before releasing."
fi

# Additional info
echo ""
echo "📝 Additional Commands:"
echo "   View all entitlements:"
echo "   codesign -d --entitlements :- \"$APP_PATH\""
echo ""
echo "   Check notarization log:"
echo "   xcrun notarytool log <submission-id> --apple-id <your-apple-id>"
echo ""
echo "   Verify with spctl:"
echo "   spctl -a -vvv \"$APP_PATH\""