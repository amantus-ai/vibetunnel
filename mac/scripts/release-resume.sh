#!/bin/bash

# =============================================================================
# VibeTunnel Release Resume Script
# =============================================================================
#
# This script resumes a failed release process from where it left off.
# It detects the current state and continues from the appropriate step.
#
# USAGE:
#   ./scripts/release-resume.sh <type> [number]
#
# ARGUMENTS:
#   type     Release type: stable, beta, alpha, rc
#   number   Pre-release number (required for beta/alpha/rc)
#
# =============================================================================

set -euo pipefail

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Parse arguments
RELEASE_TYPE="${1:-}"
PRERELEASE_NUMBER="${2:-}"

if [[ -z "$RELEASE_TYPE" ]]; then
    echo -e "${RED}❌ Error: Release type required (stable, beta, alpha, rc)${NC}"
    echo "Usage: $0 <type> [number]"
    exit 1
fi

# Load version information
VERSION_CONFIG="$PROJECT_ROOT/VibeTunnel/version.xcconfig"
MARKETING_VERSION=$(grep "MARKETING_VERSION" "$VERSION_CONFIG" | cut -d' ' -f3)
BUILD_NUMBER=$(grep "CURRENT_PROJECT_VERSION" "$VERSION_CONFIG" | cut -d' ' -f3)

echo -e "${BLUE}🔄 VibeTunnel Release Resume${NC}"
echo "============================"
echo "Version: $MARKETING_VERSION"
echo "Build: $BUILD_NUMBER"
echo "Type: $RELEASE_TYPE"
echo ""

# Determine release version and tag
RELEASE_VERSION="$MARKETING_VERSION"
TAG_NAME="v$RELEASE_VERSION"

# Check what's already done
echo -e "${BLUE}🔍 Checking release state...${NC}"

# Check 1: Is the app built and notarized?
APP_PATH="$PROJECT_ROOT/build/Build/Products/Release/VibeTunnel.app"
if [[ -d "$APP_PATH" ]] && xcrun stapler validate "$APP_PATH" 2>&1 | grep -q "The validate action worked"; then
    echo "✅ App is built and notarized"
    APP_DONE=true
else
    echo "❌ App needs to be built/notarized"
    APP_DONE=false
fi

# Check 2: Does DMG exist and is it notarized?
DMG_PATH="$PROJECT_ROOT/build/VibeTunnel-$RELEASE_VERSION.dmg"
if [[ -f "$DMG_PATH" ]] && xcrun stapler validate "$DMG_PATH" 2>&1 | grep -q "The validate action worked"; then
    echo "✅ DMG exists and is notarized"
    DMG_DONE=true
else
    echo "❌ DMG needs to be created/notarized"
    DMG_DONE=false
fi

# Check 3: Does ZIP exist?
ZIP_PATH="$PROJECT_ROOT/build/VibeTunnel-$RELEASE_VERSION.zip"
if [[ -f "$ZIP_PATH" ]]; then
    echo "✅ ZIP exists"
    ZIP_DONE=true
else
    echo "❌ ZIP needs to be created"
    ZIP_DONE=false
fi

# Check 4: Is GitHub release created?
if gh release view "$TAG_NAME" >/dev/null 2>&1; then
    echo "✅ GitHub release exists"
    GITHUB_DONE=true
else
    echo "❌ GitHub release needs to be created"
    GITHUB_DONE=false
fi

# Check 5: Is appcast updated?
APPCAST_FILE="$PROJECT_ROOT/../appcast-prerelease.xml"
if [[ "$RELEASE_TYPE" == "stable" ]]; then
    APPCAST_FILE="$PROJECT_ROOT/../appcast.xml"
fi

if grep -q "<sparkle:version>$BUILD_NUMBER</sparkle:version>" "$APPCAST_FILE" 2>/dev/null; then
    echo "✅ Appcast is updated"
    APPCAST_DONE=true
else
    echo "❌ Appcast needs to be updated"
    APPCAST_DONE=false
fi

echo ""

# Resume from appropriate step
if [[ "$APP_DONE" == "false" ]]; then
    echo -e "${RED}❌ App not built/notarized. Please run the full release script.${NC}"
    exit 1
fi

if [[ "$DMG_DONE" == "false" ]]; then
    echo -e "${BLUE}📋 Creating and notarizing DMG...${NC}"
    "$SCRIPT_DIR/create-dmg.sh" "$APP_PATH" "$DMG_PATH"
    "$SCRIPT_DIR/notarize-dmg.sh" "$DMG_PATH"
    echo -e "${GREEN}✅ DMG created and notarized${NC}"
fi

if [[ "$ZIP_DONE" == "false" ]]; then
    echo -e "${BLUE}📋 Creating ZIP...${NC}"
    "$SCRIPT_DIR/create-zip.sh" "$APP_PATH" "$ZIP_PATH"
    echo -e "${GREEN}✅ ZIP created${NC}"
fi

if [[ "$GITHUB_DONE" == "false" ]]; then
    echo -e "${BLUE}📋 Creating GitHub release...${NC}"
    
    # Create tag if it doesn't exist
    if ! git rev-parse "$TAG_NAME" >/dev/null 2>&1; then
        git tag -a "$TAG_NAME" -m "Release $RELEASE_VERSION (build $BUILD_NUMBER)"
        git push origin "$TAG_NAME"
    fi
    
    # Sign DMG for Sparkle
    echo "🔐 Signing DMG for Sparkle..."
    DMG_SIGNATURE=$(sign_update "$DMG_PATH" --account VibeTunnel | grep "sparkle:edSignature" | cut -d'"' -f2)
    echo "   Signature: $DMG_SIGNATURE"
    
    # Create release
    if [[ "$RELEASE_TYPE" == "stable" ]]; then
        gh release create "$TAG_NAME" \
            --title "VibeTunnel $RELEASE_VERSION" \
            --notes-file "$PROJECT_ROOT/../CHANGELOG.md" \
            "$DMG_PATH" \
            "$ZIP_PATH"
    else
        gh release create "$TAG_NAME" \
            --title "VibeTunnel $RELEASE_VERSION" \
            --notes-file "$PROJECT_ROOT/../CHANGELOG.md" \
            --prerelease \
            "$DMG_PATH" \
            "$ZIP_PATH"
    fi
    
    echo -e "${GREEN}✅ GitHub release created${NC}"
fi

if [[ "$APPCAST_DONE" == "false" ]]; then
    echo -e "${BLUE}📋 Updating appcast...${NC}"
    export SPARKLE_ACCOUNT="VibeTunnel"
    "$SCRIPT_DIR/generate-appcast.sh"
    
    # Commit and push appcast
    git add "$PROJECT_ROOT/../appcast*.xml" 2>/dev/null || true
    if ! git diff --cached --quiet; then
        git commit -m "Update appcast for $RELEASE_VERSION"
        git push origin main
    fi
    
    echo -e "${GREEN}✅ Appcast updated${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Release Resume Complete!${NC}"
echo "========================="
echo ""
echo -e "${GREEN}✅ Successfully completed release of VibeTunnel $RELEASE_VERSION${NC}"
echo ""
echo "Release details:"
echo "  - Version: $RELEASE_VERSION"
echo "  - Build: $BUILD_NUMBER"
echo "  - Tag: $TAG_NAME"
echo "  - GitHub: https://github.com/amantus-ai/vibetunnel/releases/tag/$TAG_NAME"