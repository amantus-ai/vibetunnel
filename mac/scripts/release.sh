#!/bin/bash

# =============================================================================
# VibeTunnel Automated Release Script
# =============================================================================
#
# This script handles the complete end-to-end release process for VibeTunnel,
# including building, signing, notarization, DMG creation, GitHub releases,
# and appcast updates. It supports both stable and pre-release versions.
#
# USAGE:
#   ./scripts/release.sh [--dry-run] <type> [number]
#
# ARGUMENTS:
#   type     Release type: stable, beta, alpha, rc
#   number   Pre-release number (required for beta/alpha/rc)
#
# OPTIONS:
#   --dry-run   Preview what would be done without making changes
#
# IMPORTANT NOTES:
#   - This script can take 10-15 minutes due to notarization
#   - If running from Claude or other tools with timeouts, use a longer timeout
#   - If the script fails partway, use release-resume.sh to continue
#
# FEATURES:
#   - Complete build and release automation
#   - Automatic IS_PRERELEASE_BUILD flag handling
#   - Code signing and notarization
#   - DMG creation with signing
#   - GitHub release creation with assets
#   - Appcast XML generation and updates
#   - Git tag management and commit automation
#   - Comprehensive error checking and validation
#
# ENVIRONMENT VARIABLES:
#   APP_STORE_CONNECT_API_KEY_P8    App Store Connect API key (for notarization)
#   APP_STORE_CONNECT_KEY_ID        API Key ID
#   APP_STORE_CONNECT_ISSUER_ID     API Key Issuer ID
#
# DEPENDENCIES:
#   - preflight-check.sh (validates release readiness)
#   - Xcode workspace and project files
#   - build.sh (application building)
#   - sign-and-notarize.sh (code signing and notarization)
#   - create-dmg.sh (DMG creation)
#   - generate-appcast.sh (appcast updates)
#   - GitHub CLI (gh) for release creation
#   - Sparkle tools (sign_update) for EdDSA signatures
#
# RELEASE PROCESS:
#   1. Pre-flight validation (git status, tools, certificates)
#   2. Xcode project generation and commit if needed
#   3. Application building with appropriate flags
#   4. Code signing and notarization
#   5. DMG creation and signing
#   6. GitHub release creation with assets
#   7. Appcast XML generation and updates
#   8. Git commits and pushes
#
# EXAMPLES:
#   ./scripts/release.sh stable         # Create stable release
#   ./scripts/release.sh beta 1         # Create beta.1 release
#   ./scripts/release.sh alpha 2        # Create alpha.2 release
#   ./scripts/release.sh rc 1           # Create rc.1 release
#   ./scripts/release.sh --dry-run stable     # Preview stable release
#   ./scripts/release.sh --dry-run beta 1     # Preview beta.1 release
#
# OUTPUT:
#   - GitHub release at: https://github.com/amantus-ai/vibetunnel/releases
#   - Signed DMG file in build/ directory
#   - Updated appcast.xml and appcast-prerelease.xml files
#   - Git commits and tags pushed to repository
#
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source state management functions
source "$SCRIPT_DIR/release-state.sh"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse arguments and flags
DRY_RUN=false
RELEASE_TYPE=""
PRERELEASE_NUMBER=""
RESUME_MODE=false

# Function to show usage
show_usage() {
    echo "Usage:"
    echo "  $0 [--dry-run] <release-type> [number]"
    echo "  $0 --resume"
    echo "  $0 --status"
    echo ""
    echo "Arguments:"
    echo "  release-type    stable, beta, alpha, or rc"
    echo "  number          Pre-release number (required for beta/alpha/rc)"
    echo ""
    echo "Options:"
    echo "  --dry-run       Show what would be done without making changes"
    echo "  --resume        Resume an interrupted release"
    echo "  --status        Show current release progress"
    echo ""
    echo "Examples:"
    echo "  $0 stable                    # Create stable release"
    echo "  $0 beta 1                    # Create beta.1 release"
    echo "  $0 alpha 2                   # Create alpha.2 release"
    echo "  $0 rc 3                      # Create rc.3 release"
    echo "  $0 --dry-run stable          # Preview stable release"
    echo "  $0 --dry-run beta 1          # Preview beta.1 release"
    echo "  $0 --resume                  # Resume interrupted release"
    echo "  $0 --status                  # Check release progress"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --resume)
            RESUME_MODE=true
            shift
            ;;
        --status)
            show_progress
            exit 0
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        stable|beta|alpha|rc)
            if [[ -n "$RELEASE_TYPE" ]]; then
                echo -e "${RED}❌ Error: Release type already specified as '$RELEASE_TYPE'${NC}"
                echo ""
                show_usage
                exit 1
            fi
            RELEASE_TYPE="$1"
            shift
            ;;
        *)
            # Check if this could be a pre-release number
            if [[ -n "$RELEASE_TYPE" ]] && [[ "$RELEASE_TYPE" != "stable" ]] && [[ -z "$PRERELEASE_NUMBER" ]]; then
                # This might be intended as a pre-release number
                PRERELEASE_NUMBER="$1"
                shift
            else
                echo -e "${RED}❌ Error: Unknown argument: $1${NC}"
                echo ""
                show_usage
                exit 1
            fi
            ;;
    esac
done

# Handle resume mode
if [[ "$RESUME_MODE" == "true" ]]; then
    if ! can_resume; then
        echo -e "${RED}❌ Error: No release in progress to resume${NC}"
        echo ""
        echo "Start a new release with: $0 <release-type> [number]"
        exit 1
    fi
    
    # Load release info from state
    RELEASE_TYPE=$(get_release_info "release_type")
    RELEASE_VERSION=$(get_release_info "release_version")
    BUILD_NUMBER=$(get_release_info "build_number")
    TAG_NAME=$(get_release_info "tag_name")
    
    echo -e "${BLUE}📋 Resuming release${NC}"
    show_progress
    echo ""
else
    # Normal mode - validate required arguments
    if [[ -z "$RELEASE_TYPE" ]]; then
        echo -e "${RED}❌ Error: Release type is required${NC}"
        echo ""
        show_usage
        exit 1
    fi
fi

# Validate release type
case "$RELEASE_TYPE" in
    stable|beta|alpha|rc)
        # Valid release type
        ;;
    *)
        echo -e "${RED}❌ Error: Invalid release type: $RELEASE_TYPE${NC}"
        echo "Valid types are: stable, beta, alpha, rc"
        echo ""
        show_usage
        exit 1
        ;;
esac

# For pre-releases, validate number
if [[ "$RELEASE_TYPE" != "stable" ]]; then
    if [[ -z "$PRERELEASE_NUMBER" ]]; then
        echo -e "${RED}❌ Error: Pre-release number is required for $RELEASE_TYPE releases${NC}"
        echo ""
        echo "Example: $0 $RELEASE_TYPE 1"
        echo ""
        show_usage
        exit 1
    fi
    
    # Validate that pre-release number is a positive integer
    if ! [[ "$PRERELEASE_NUMBER" =~ ^[0-9]+$ ]] || [[ "$PRERELEASE_NUMBER" -eq 0 ]]; then
        echo -e "${RED}❌ Error: Pre-release number must be a positive integer${NC}"
        echo "Got: '$PRERELEASE_NUMBER'"
        echo ""
        show_usage
        exit 1
    fi
elif [[ -n "$PRERELEASE_NUMBER" ]]; then
    echo -e "${YELLOW}⚠️  Warning: Pre-release number ignored for stable releases${NC}"
    PRERELEASE_NUMBER=""
fi

echo -e "${BLUE}🚀 VibeTunnel Automated Release${NC}"
echo "=============================="
echo ""

# Show dry-run mode if enabled
if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${YELLOW}🔍 DRY RUN MODE - No changes will be made${NC}"
    echo ""
fi

# Additional strict pre-conditions before preflight check
echo -e "${BLUE}🔍 Running strict pre-conditions...${NC}"

# CHANGELOG.md will be checked later with proper fallback logic

# Clean up any stuck VibeTunnel volumes before starting
echo "🧹 Cleaning up any stuck DMG volumes..."
for volume in /Volumes/VibeTunnel*; do
    if [ -d "$volume" ]; then
        echo "   Unmounting $volume..."
        hdiutil detach "$volume" -force 2>/dev/null || true
    fi
done

# Check if we're on main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "main" ]]; then
    echo -e "${RED}❌ Error: Must be on main branch to release (current: $CURRENT_BRANCH)${NC}"
    echo "   Run: git checkout main"
    exit 1
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo -e "${RED}❌ Error: Uncommitted changes detected${NC}"
    echo "   Please commit or stash your changes before releasing"
    git status --short
    exit 1
fi

# Check if IS_PRERELEASE_BUILD is already set in environment
if [[ -n "${IS_PRERELEASE_BUILD:-}" ]]; then
    echo -e "${YELLOW}⚠️  Warning: IS_PRERELEASE_BUILD is already set to: $IS_PRERELEASE_BUILD${NC}"
    echo "   This will be overridden by the release script"
    unset IS_PRERELEASE_BUILD
fi

# Check for required environment variables for notarization
if [[ -z "${APP_STORE_CONNECT_API_KEY_P8:-}" ]] || \
   [[ -z "${APP_STORE_CONNECT_KEY_ID:-}" ]] || \
   [[ -z "${APP_STORE_CONNECT_ISSUER_ID:-}" ]]; then
    echo -e "${RED}❌ Error: Missing notarization environment variables${NC}"
    echo "   Required variables:"
    echo "   - APP_STORE_CONNECT_API_KEY_P8"
    echo "   - APP_STORE_CONNECT_KEY_ID"  
    echo "   - APP_STORE_CONNECT_ISSUER_ID"
    exit 1
fi

# Check if notarize-dmg.sh exists
if [[ ! -x "$SCRIPT_DIR/notarize-dmg.sh" ]]; then
    echo -e "${RED}❌ Error: notarize-dmg.sh not found or not executable${NC}"
    echo "   Expected at: $SCRIPT_DIR/notarize-dmg.sh"
    exit 1
fi

# Check if GitHub CLI is installed and authenticated
if ! command -v gh >/dev/null 2>&1; then
    echo -e "${RED}❌ Error: GitHub CLI (gh) is not installed${NC}"
    echo "   Install with: brew install gh"
    exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
    echo -e "${RED}❌ Error: GitHub CLI is not authenticated${NC}"
    echo "   Run: gh auth login"
    exit 1
fi

# Check if changelog file exists in project root
if [[ -f "$PROJECT_ROOT/../CHANGELOG.md" ]]; then
    CHANGELOG_PATH="$PROJECT_ROOT/../CHANGELOG.md"
else
    echo -e "${YELLOW}⚠️  Warning: CHANGELOG.md not found${NC}"
    echo "   Expected location: $PROJECT_ROOT/../CHANGELOG.md"
    echo "   Release notes will be basic"
    CHANGELOG_PATH=""
fi

# Check if we're up to date with origin/main
git fetch origin main --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [[ "$LOCAL" != "$REMOTE" ]]; then
    echo -e "${RED}❌ Error: Not up to date with origin/main${NC}"
    echo "   Run: git pull --rebase origin main"
    exit 1
fi

echo -e "${GREEN}✅ Strict pre-conditions passed${NC}"
echo ""

# Step 1: Run pre-flight check
echo -e "${BLUE}📋 Step 1/8: Running pre-flight check...${NC}"
if ! "$SCRIPT_DIR/preflight-check.sh"; then
    echo ""
    echo -e "${RED}❌ Pre-flight check failed. Please fix the issues above.${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Pre-flight check passed!${NC}"
echo ""

# Get version info
VERSION_CONFIG="$PROJECT_ROOT/VibeTunnel/version.xcconfig"
if [[ -f "$VERSION_CONFIG" ]]; then
    MARKETING_VERSION=$(grep 'MARKETING_VERSION' "$VERSION_CONFIG" | sed 's/.*MARKETING_VERSION = //')
    BUILD_NUMBER=$(grep 'CURRENT_PROJECT_VERSION' "$VERSION_CONFIG" | sed 's/.*CURRENT_PROJECT_VERSION = //')
else
    echo -e "${RED}❌ Error: Version configuration file not found at $VERSION_CONFIG${NC}"
    exit 1
fi

# Determine release version
if [[ "$RELEASE_TYPE" == "stable" ]]; then
    RELEASE_VERSION="$MARKETING_VERSION"
    TAG_NAME="v$RELEASE_VERSION"
else
    # Check if MARKETING_VERSION already contains the pre-release suffix
    EXPECTED_SUFFIX="$RELEASE_TYPE.$PRERELEASE_NUMBER"
    if [[ "$MARKETING_VERSION" == *"-$EXPECTED_SUFFIX" ]]; then
        # Version already has the correct suffix, use as-is
        RELEASE_VERSION="$MARKETING_VERSION"
    else
        # Add the suffix
        RELEASE_VERSION="$MARKETING_VERSION-$RELEASE_TYPE.$PRERELEASE_NUMBER"
    fi
    TAG_NAME="v$RELEASE_VERSION"
fi

echo "📦 Preparing release:"
echo "   Type: $RELEASE_TYPE"
echo "   Version: $RELEASE_VERSION"
echo "   Build: $BUILD_NUMBER"
echo "   Tag: $TAG_NAME"
echo ""

# Initialize state tracking for new releases
if [[ "$RESUME_MODE" != "true" ]]; then
    init_state "$RELEASE_TYPE" "$RELEASE_VERSION" "$BUILD_NUMBER" "$TAG_NAME"
fi

# Additional validation after version determination
echo -e "${BLUE}🔍 Validating release configuration...${NC}"

# Check for double suffix issue
if [[ "$RELEASE_VERSION" =~ -[a-zA-Z]+\.[0-9]+-[a-zA-Z]+\.[0-9]+ ]]; then
    echo -e "${RED}❌ Error: Version has double suffix: $RELEASE_VERSION${NC}"
    echo "   This indicates version.xcconfig already has a pre-release suffix"
    echo "   Current MARKETING_VERSION: $MARKETING_VERSION"
    exit 1
fi

# Verify build number hasn't been used
echo "🔍 Checking build number uniqueness..."
EXISTING_BUILDS=""
if [[ -f "$PROJECT_ROOT/../appcast.xml" ]]; then
    APPCAST_BUILDS=$(grep -E '<sparkle:version>[0-9]+</sparkle:version>' "$PROJECT_ROOT/../appcast.xml" 2>/dev/null | sed 's/.*<sparkle:version>\([0-9]*\)<\/sparkle:version>.*/\1/' | tr '\n' ' ' || true)
    EXISTING_BUILDS+="$APPCAST_BUILDS"
fi
if [[ -f "$PROJECT_ROOT/../appcast-prerelease.xml" ]]; then
    PRERELEASE_BUILDS=$(grep -E '<sparkle:version>[0-9]+</sparkle:version>' "$PROJECT_ROOT/../appcast-prerelease.xml" 2>/dev/null | sed 's/.*<sparkle:version>\([0-9]*\)<\/sparkle:version>.*/\1/' | tr '\n' ' ' || true)
    EXISTING_BUILDS+="$PRERELEASE_BUILDS"
fi

for EXISTING_BUILD in $EXISTING_BUILDS; do
    if [[ "$BUILD_NUMBER" == "$EXISTING_BUILD" ]]; then
        echo -e "${RED}❌ Error: Build number $BUILD_NUMBER already exists in appcast!${NC}"
        echo "   Please increment CURRENT_PROJECT_VERSION in version.xcconfig"
        exit 1
    fi
done

echo -e "${GREEN}✅ Release configuration validated${NC}"
echo ""

# Step 2: Clean build directory
echo -e "${BLUE}📋 Step 2/8: Cleaning build directory...${NC}"
rm -rf "$PROJECT_ROOT/build"
rm -rf "$PROJECT_ROOT/DerivedData"
# rm -rf "$PROJECT_ROOT/.build"
rm -rf ~/Library/Developer/Xcode/DerivedData/VibeTunnel-*
echo "✓ Cleaned all build artifacts"

# Step 3: Update version in version.xcconfig
echo ""
echo -e "${BLUE}📋 Step 3/8: Setting version...${NC}"

# Determine the version string to set
if [[ "$RELEASE_TYPE" == "stable" ]]; then
    # For stable releases, ensure MARKETING_VERSION doesn't have pre-release suffix
    # Extract base version (remove any existing pre-release suffix)
    BASE_VERSION=$(echo "$MARKETING_VERSION" | sed 's/-.*$//')
    VERSION_TO_SET="$BASE_VERSION"
else
    # For pre-releases, use the RELEASE_VERSION we calculated above
    # (which already handles whether to add suffix or not)
    VERSION_TO_SET="$RELEASE_VERSION"
fi

if [[ "$DRY_RUN" == "true" ]]; then
    echo "📝 Would update MARKETING_VERSION to: $VERSION_TO_SET"
    echo "   Current value: $MARKETING_VERSION"
    echo -e "${GREEN}✅ Version would be set to: $VERSION_TO_SET${NC}"
else
    # Backup version.xcconfig
    cp "$VERSION_CONFIG" "$VERSION_CONFIG.bak"
    
    # Update MARKETING_VERSION in version.xcconfig
    echo "📝 Updating MARKETING_VERSION to: $VERSION_TO_SET"
    sed -i '' "s/MARKETING_VERSION = .*/MARKETING_VERSION = $VERSION_TO_SET/" "$VERSION_CONFIG"
    
    # Verify the update
    NEW_MARKETING_VERSION=$(grep 'MARKETING_VERSION' "$VERSION_CONFIG" | sed 's/.*MARKETING_VERSION = //')
    if [[ "$NEW_MARKETING_VERSION" != "$VERSION_TO_SET" ]]; then
        echo -e "${RED}❌ Failed to update MARKETING_VERSION${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Version updated to: $VERSION_TO_SET${NC}"
fi

# Check if Xcode project was modified and commit if needed
if ! git diff --quiet "$PROJECT_ROOT/VibeTunnel.xcodeproj/project.pbxproj"; then
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "📝 Would commit Xcode project changes"
        echo "   Commit message: Update Xcode project for build $BUILD_NUMBER"
    else
        echo "📝 Committing Xcode project changes..."
        git add "$PROJECT_ROOT/VibeTunnel.xcodeproj/project.pbxproj"
        git commit -m "Update Xcode project for build $BUILD_NUMBER"
        echo -e "${GREEN}✅ Xcode project changes committed${NC}"
    fi
fi

# Step 4: Build the app
echo ""
echo -e "${BLUE}📋 Step 4/8: Building universal application...${NC}"

if [[ "$DRY_RUN" == "true" ]]; then
    echo "🔨 Would build ARM64 binary with:"
    echo "   Configuration: Release"
    echo "   IS_PRERELEASE_BUILD: $([ "$RELEASE_TYPE" != "stable" ] && echo "YES" || echo "NO")"
    echo "   Command: $SCRIPT_DIR/build.sh --configuration Release"
    echo ""
    echo "   Would verify:"
    echo "   - App exists at expected path"
    echo "   - Build number matches $BUILD_NUMBER"
    echo "   - Binary architecture is ARM64"
    echo -e "${GREEN}✅ Build would be performed${NC}"
else
    # Check for custom Node.js build
    echo ""
    echo "🔍 Checking for custom Node.js build..."
    WEB_DIR="$PROJECT_ROOT/../web"
    
    # Check if .node-builds directory exists
    if [[ -d "$WEB_DIR/.node-builds" ]]; then
        CUSTOM_NODE_PATH=$(find "$WEB_DIR/.node-builds" -name "node-v*-minimal" -type d 2>/dev/null | sort -V | tail -n1)/out/Release/node
    else
        CUSTOM_NODE_PATH=""
    fi
    
    if [[ ! -f "$CUSTOM_NODE_PATH" ]]; then
        echo -e "${YELLOW}⚠️  Custom Node.js not found. Using system Node.js...${NC}"
        echo "   Note: Release will work but app size will be larger."
        # Continue with default Node.js
    else
        CUSTOM_NODE_SIZE=$(ls -lh "$CUSTOM_NODE_PATH" | awk '{print $5}')
        CUSTOM_NODE_VERSION=$("$CUSTOM_NODE_PATH" --version 2>/dev/null || echo "unknown")
        echo -e "${GREEN}✅ Found custom Node.js${NC}"
        echo "   Version: $CUSTOM_NODE_VERSION"
        echo "   Size: $CUSTOM_NODE_SIZE"
    fi
    
    # For pre-release builds, set the environment variable
    if [[ "$RELEASE_TYPE" != "stable" ]]; then
        echo "📝 Marking build as pre-release..."
        export IS_PRERELEASE_BUILD=YES
    else
        export IS_PRERELEASE_BUILD=NO
    fi
    
    # Build ARM64 binary
    echo ""
    echo "🔨 Building ARM64 binary..."
    "$SCRIPT_DIR/build.sh" --configuration Release
    
    # Find the built app - could be in build directory or DerivedData
    APP_PATH="$PROJECT_ROOT/build/Build/Products/Release/VibeTunnel.app"
    if [[ ! -d "$APP_PATH" ]]; then
        # Check DerivedData
        DEFAULT_DERIVED_DATA="$HOME/Library/Developer/Xcode/DerivedData"
        APP_PATH=$(find "$DEFAULT_DERIVED_DATA" -name "VibeTunnel.app" -path "*/Build/Products/Release/*" ! -path "*/Index.noindex/*" 2>/dev/null | head -n 1)
        
        if [[ ! -d "$APP_PATH" ]]; then
            echo -e "${RED}❌ Build failed - app not found${NC}"
            exit 1
        fi
        
        # Copy to expected location for consistency
        mkdir -p "$PROJECT_ROOT/build/Build/Products/Release"
        cp -R "$APP_PATH" "$PROJECT_ROOT/build/Build/Products/Release/"
        APP_PATH="$PROJECT_ROOT/build/Build/Products/Release/VibeTunnel.app"
    fi
    
    # Verify build number
    BUILT_VERSION=$(defaults read "$APP_PATH/Contents/Info.plist" CFBundleVersion)
    if [[ "$BUILT_VERSION" != "$BUILD_NUMBER" ]]; then
        echo -e "${RED}❌ Build number mismatch! Expected $BUILD_NUMBER but got $BUILT_VERSION${NC}"
        exit 1
    fi
    
    # Verify it's an ARM64 binary
    APP_BINARY="$APP_PATH/Contents/MacOS/VibeTunnel"
    if [[ -f "$APP_BINARY" ]]; then
        ARCH_INFO=$(lipo -info "$APP_BINARY" 2>/dev/null || echo "")
        if [[ "$ARCH_INFO" == *"arm64"* ]]; then
            echo "✅ ARM64 binary created"
        else
            echo -e "${RED}❌ Error: Binary is not ARM64: $ARCH_INFO${NC}"
            exit 1
        fi
    fi
    
    echo -e "${GREEN}✅ Build complete${NC}"
fi

# Step 5: Sign and notarize
echo ""
echo -e "${BLUE}📋 Step 5/8: Signing and notarizing...${NC}"

if [[ "$DRY_RUN" == "true" ]]; then
    echo "🔐 Would sign and notarize the application"
    echo "   Command: $SCRIPT_DIR/sign-and-notarize.sh --sign-and-notarize"
    echo -e "${GREEN}✅ Signing and notarization would be performed${NC}"
    
    # For dry run, we need to exit early since we don't have actual build artifacts
    echo ""
    echo -e "${BLUE}📋 Remaining steps (would be performed):${NC}"
    echo "   6/8: Creating DMG and ZIP"
    echo "   7/8: Creating GitHub release with tag $TAG_NAME"
    echo "   8/8: Updating appcast files"
    echo "   9/9: Committing and pushing changes"
    echo ""
    echo "📦 Release summary:"
    echo "   Type: $RELEASE_TYPE"
    echo "   Version: $RELEASE_VERSION"
    echo "   Build: $BUILD_NUMBER"
    echo "   Tag: $TAG_NAME"
    echo ""
    echo -e "${GREEN}🎉 Dry run complete!${NC}"
    echo ""
    echo "To perform the actual release, run without --dry-run:"
    echo "   $0 $RELEASE_TYPE${PRERELEASE_NUMBER:+ $PRERELEASE_NUMBER}"
    exit 0
fi

"$SCRIPT_DIR/sign-and-notarize.sh" --sign-and-notarize

# Verify Sparkle component signing
echo ""
echo -e "${BLUE}🔍 Verifying Sparkle component signatures...${NC}"
SPARKLE_OK=true

# Check each Sparkle component for proper signing with timestamps
if [ -d "$APP_PATH/Contents/Frameworks/Sparkle.framework/Versions/B/XPCServices/Installer.xpc" ]; then
    CODESIGN_OUT=$(codesign -dv "$APP_PATH/Contents/Frameworks/Sparkle.framework/Versions/B/XPCServices/Installer.xpc" 2>&1)
    if echo "$CODESIGN_OUT" | grep -qE "(Timestamp|timestamp)"; then
        echo "✅ Installer.xpc properly signed with timestamp"
    else
        echo -e "${RED}❌ Installer.xpc missing timestamp signature${NC}"
        SPARKLE_OK=false
    fi
fi

if [ "$SPARKLE_OK" = false ]; then
    echo -e "${RED}❌ Sparkle component signing verification failed!${NC}"
    exit 1
fi

echo -e "${GREEN}✅ All Sparkle components properly signed${NC}"

# Step 6: Create DMG and ZIP
echo ""
echo -e "${BLUE}📋 Step 6/8: Creating DMG and ZIP...${NC}"
DMG_NAME="VibeTunnel-$RELEASE_VERSION.dmg"
DMG_PATH="$PROJECT_ROOT/build/$DMG_NAME"
ZIP_NAME="VibeTunnel-$RELEASE_VERSION.zip"
ZIP_PATH="$PROJECT_ROOT/build/$ZIP_NAME"

"$SCRIPT_DIR/create-dmg.sh" "$APP_PATH" "$DMG_PATH"
if [[ ! -f "$DMG_PATH" ]]; then
    echo -e "${RED}❌ DMG creation failed${NC}"
    exit 1
fi

"$SCRIPT_DIR/create-zip.sh" "$APP_PATH" "$ZIP_PATH"
if [[ ! -f "$ZIP_PATH" ]]; then
    echo -e "${RED}❌ ZIP creation failed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ DMG and ZIP created${NC}"

# Step 6.5: Notarize DMG
echo ""
echo -e "${BLUE}📋 Notarizing DMG...${NC}"
"$SCRIPT_DIR/notarize-dmg.sh" "$DMG_PATH"
echo -e "${GREEN}✅ DMG notarized${NC}"

# Verify DMG notarization
echo ""
echo -e "${BLUE}🔍 Verifying DMG notarization...${NC}"

# Check if DMG is properly signed
if codesign -dv "$DMG_PATH" &>/dev/null; then
    echo "✅ DMG is signed"
else
    echo -e "${RED}❌ Error: DMG is not signed${NC}"
    exit 1
fi

# Verify notarization with spctl
if spctl -a -t open --context context:primary-signature -v "$DMG_PATH" 2>&1 | grep -q "accepted"; then
    echo "✅ DMG notarization verified - accepted by Gatekeeper"
else
    echo -e "${YELLOW}⚠️  Warning: Could not verify DMG notarization with spctl${NC}"
    echo "   This might be normal in some environments"
fi

# Check if notarization ticket is stapled
if xcrun stapler validate "$DMG_PATH" 2>&1 | grep -q "The validate action worked"; then
    echo "✅ Notarization ticket is properly stapled"
else
    echo -e "${RED}❌ Error: Notarization ticket is not stapled to DMG${NC}"
    echo "   Users may experience delays when opening the DMG"
    exit 1
fi

# Verify app inside DMG
DMG_MOUNT=$(mktemp -d)
if hdiutil attach "$DMG_PATH" -mountpoint "$DMG_MOUNT" -nobrowse -quiet; then
    DMG_APP="$DMG_MOUNT/VibeTunnel.app"
    
    # Check if app is notarized
    if spctl -a -t exec -vv "$DMG_APP" 2>&1 | grep -q "source=Notarized Developer ID"; then
        echo "✅ App in DMG is properly notarized"
    else
        echo -e "${RED}❌ App in DMG is not properly notarized!${NC}"
        hdiutil detach "$DMG_MOUNT" -quiet
        exit 1
    fi
    
    hdiutil detach "$DMG_MOUNT" -quiet
else
    echo -e "${RED}❌ Failed to mount DMG for verification${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ DMG notarized and verified${NC}"

# Size validation
echo ""
echo -e "${BLUE}📏 Validating release size...${NC}"
DMG_SIZE=$(stat -f %z "$DMG_PATH" 2>/dev/null || stat -c %s "$DMG_PATH" 2>/dev/null)
DMG_SIZE_MB=$((DMG_SIZE / 1024 / 1024))
echo "DMG size: ${DMG_SIZE_MB} MB"

# Expected size range (42-50 MB based on recent releases)
MIN_SIZE_MB=40
MAX_SIZE_MB=50

if [[ $DMG_SIZE_MB -lt $MIN_SIZE_MB ]]; then
    echo -e "${RED}❌ DMG size is unexpectedly small (${DMG_SIZE_MB} MB < ${MIN_SIZE_MB} MB)${NC}"
    echo "This might indicate missing components."
    exit 1
elif [[ $DMG_SIZE_MB -gt $MAX_SIZE_MB ]]; then
    echo -e "${YELLOW}⚠️  DMG size is larger than expected (${DMG_SIZE_MB} MB > ${MAX_SIZE_MB} MB)${NC}"
    echo "Checking for development files in app bundle..."
    
    # Mount DMG and check for common issues
    DMG_MOUNT_CHECK=$(mktemp -d)
    if hdiutil attach "$DMG_PATH" -mountpoint "$DMG_MOUNT_CHECK" -nobrowse -quiet; then
        APP_IN_DMG="$DMG_MOUNT_CHECK/VibeTunnel.app"
        
        # Check for node_modules
        if find "$APP_IN_DMG" -name "node_modules" -type d | grep -q .; then
            echo -e "${RED}❌ Found node_modules in app bundle!${NC}"
            find "$APP_IN_DMG" -name "node_modules" -type d
            hdiutil detach "$DMG_MOUNT_CHECK" -quiet
            exit 1
        fi
        
        # Check for JAR files
        if find "$APP_IN_DMG" -name "*.jar" -type f | grep -q .; then
            echo -e "${RED}❌ Found JAR files in app bundle!${NC}"
            find "$APP_IN_DMG" -name "*.jar" -type f
            hdiutil detach "$DMG_MOUNT_CHECK" -quiet
            exit 1
        fi
        
        # List large files
        echo "Large files in app bundle (>1MB):"
        find "$APP_IN_DMG" -type f -size +1M -exec ls -lh {} \; | awk '{print $5 " " $9}'
        
        hdiutil detach "$DMG_MOUNT_CHECK" -quiet
    fi
    
    echo "Consider investigating the size increase before proceeding."
    read -p "Continue anyway? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}❌ Release cancelled due to size concerns${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✅ DMG size is within expected range${NC}"
fi

# Step 6: Create GitHub release
echo ""
echo -e "${BLUE}📋 Step 7/9: Creating GitHub release...${NC}"

# Check if tag already exists locally
if git rev-parse "$TAG_NAME" >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Tag $TAG_NAME already exists locally!${NC}"
    DELETE_EXISTING=true
else
    # Check if tag exists on remote
    if git ls-remote --tags origin | grep -q "refs/tags/$TAG_NAME"; then
        echo -e "${YELLOW}⚠️  Tag $TAG_NAME already exists on remote!${NC}"
        DELETE_EXISTING=true
    else
        DELETE_EXISTING=false
    fi
fi

if [[ "$DELETE_EXISTING" == "true" ]]; then
    # Check if a release exists for this tag
    if gh release view "$TAG_NAME" >/dev/null 2>&1; then
        echo ""
        echo "A GitHub release already exists for this tag."
        echo "What would you like to do?"
        echo "  1) Delete the existing release and tag, then create new ones"
        echo "  2) Cancel the release"
        echo ""
        read -p "Enter your choice (1 or 2): " choice
        
        case $choice in
            1)
                echo "🗑️  Deleting existing release and tag..."
                gh release delete "$TAG_NAME" --yes 2>/dev/null || true
                git tag -d "$TAG_NAME"
                git push origin :refs/tags/"$TAG_NAME" 2>/dev/null || true
                echo -e "${GREEN}✅ Existing release and tag deleted${NC}"
                ;;
            2)
                echo -e "${RED}❌ Release cancelled${NC}"
                exit 1
                ;;
            *)
                echo -e "${RED}❌ Invalid choice. Release cancelled${NC}"
                exit 1
                ;;
        esac
    else
        # Tag exists but no release - just delete the tag
        echo "🗑️  Deleting existing tag..."
        git tag -d "$TAG_NAME"
        git push origin :refs/tags/"$TAG_NAME" 2>/dev/null || true
        echo -e "${GREEN}✅ Existing tag deleted${NC}"
    fi
fi

# Create and push tag
echo "🏷️  Creating tag $TAG_NAME..."
git tag -a "$TAG_NAME" -m "Release $RELEASE_VERSION (build $BUILD_NUMBER)"
git push origin "$TAG_NAME"

# Create release
echo "📤 Creating GitHub release..."

# Generate release notes from changelog
echo "📝 Generating release notes from changelog..."
RELEASE_NOTES=""

# Use generate-release-notes.sh for better markdown output
if [[ -x "$SCRIPT_DIR/generate-release-notes.sh" ]]; then
    echo "   Using generate-release-notes.sh for version $RELEASE_VERSION"
    RELEASE_NOTES=$("$SCRIPT_DIR/generate-release-notes.sh" "$RELEASE_VERSION" 2>/dev/null || echo "")
    
    # Check if we got valid content
    if [[ -n "$RELEASE_NOTES" ]] && [[ "$RELEASE_NOTES" != *"This release includes various improvements and bug fixes"* ]]; then
        echo "✅ Generated release notes from changelog"
    else
        echo "⚠️  Could not extract specific changelog for version $RELEASE_VERSION"
        RELEASE_NOTES=""
    fi
fi

# Fallback to basic release notes if changelog extraction fails
if [[ -z "$RELEASE_NOTES" ]]; then
    echo "   Generating fallback release notes..."
    RELEASE_NOTES="## VibeTunnel $RELEASE_VERSION

This release includes various improvements and bug fixes.

For details, please see the [CHANGELOG](https://github.com/amantus-ai/vibetunnel/blob/main/CHANGELOG.md).

**Build**: $BUILD_NUMBER"
fi

# Format the release title properly
# Convert "1.0.0-beta.10" to "VibeTunnel 1.0.0 Beta 10"
RELEASE_TITLE="VibeTunnel $RELEASE_VERSION"
if [[ "$RELEASE_VERSION" =~ ^([0-9]+\.[0-9]+\.[0-9]+)-beta\.([0-9]+)$ ]]; then
    VERSION_BASE="${BASH_REMATCH[1]}"
    BETA_NUM="${BASH_REMATCH[2]}"
    RELEASE_TITLE="VibeTunnel $VERSION_BASE Beta $BETA_NUM"
elif [[ "$RELEASE_VERSION" =~ ^([0-9]+\.[0-9]+\.[0-9]+)-alpha\.([0-9]+)$ ]]; then
    VERSION_BASE="${BASH_REMATCH[1]}"
    ALPHA_NUM="${BASH_REMATCH[2]}"
    RELEASE_TITLE="VibeTunnel $VERSION_BASE Alpha $ALPHA_NUM"
elif [[ "$RELEASE_VERSION" =~ ^([0-9]+\.[0-9]+\.[0-9]+)-rc\.([0-9]+)$ ]]; then
    VERSION_BASE="${BASH_REMATCH[1]}"
    RC_NUM="${BASH_REMATCH[2]}"
    RELEASE_TITLE="VibeTunnel $VERSION_BASE RC $RC_NUM"
fi

if [[ "$RELEASE_TYPE" == "stable" ]]; then
    gh release create "$TAG_NAME" \
        --title "$RELEASE_TITLE" \
        --notes "$RELEASE_NOTES" \
        "$DMG_PATH" \
        "$ZIP_PATH"
else
    gh release create "$TAG_NAME" \
        --title "$RELEASE_TITLE" \
        --notes "$RELEASE_NOTES" \
        --prerelease \
        "$DMG_PATH" \
        "$ZIP_PATH"
fi

echo -e "${GREEN}✅ GitHub release created${NC}"

# Step 7: Update appcast
echo ""
echo -e "${BLUE}📋 Step 8/9: Updating appcast...${NC}"

# Generate appcast
echo "🔐 Generating appcast with EdDSA signatures..."
# Set the Sparkle account for sign_update
export SPARKLE_ACCOUNT="VibeTunnel"
echo "   Using Sparkle account: $SPARKLE_ACCOUNT"
"$SCRIPT_DIR/generate-appcast.sh"

# Verify the appcast was updated
if [[ "$RELEASE_TYPE" == "stable" ]]; then
    if ! grep -q "<sparkle:version>$BUILD_NUMBER</sparkle:version>" "$PROJECT_ROOT/../appcast.xml"; then
        echo -e "${YELLOW}⚠️  Appcast may not have been updated. Please check manually.${NC}"
    fi
else
    if ! grep -q "<sparkle:version>$BUILD_NUMBER</sparkle:version>" "$PROJECT_ROOT/../appcast-prerelease.xml"; then
        echo -e "${YELLOW}⚠️  Pre-release appcast may not have been updated. Please check manually.${NC}"
    fi
fi

echo -e "${GREEN}✅ Appcast updated${NC}"

# Commit and push appcast and version files
echo ""
echo "📤 Committing and pushing changes..."

# Add version.xcconfig changes
git add "$VERSION_CONFIG" 2>/dev/null || true

# Add appcast files (they're in project root, not mac/)
if [[ -f "$PROJECT_ROOT/../appcast.xml" ]]; then
    git add "$PROJECT_ROOT/../appcast.xml" 2>/dev/null || true
else
    echo -e "${YELLOW}⚠️  Warning: appcast.xml not found in project root${NC}"
fi
if [[ -f "$PROJECT_ROOT/../appcast-prerelease.xml" ]]; then
    git add "$PROJECT_ROOT/../appcast-prerelease.xml" 2>/dev/null || true
else
    echo -e "${YELLOW}⚠️  Warning: appcast-prerelease.xml not found in project root${NC}"
fi

if ! git diff --cached --quiet; then
    git commit -m "Update appcast and version for $RELEASE_VERSION"
    git push origin main
    echo -e "${GREEN}✅ Changes pushed${NC}"
else
    echo "ℹ️  No changes to commit"
fi

# For pre-releases, optionally restore base version
if [[ "$RELEASE_TYPE" != "stable" ]]; then
    echo ""
    echo "📝 Note: MARKETING_VERSION is now set to '$VERSION_TO_SET'"
    echo "   To restore base version for development, run:"
    echo "   git checkout -- $VERSION_CONFIG"
fi

# Optional: Verify appcast
echo ""
echo "🔍 Verifying appcast files..."
if "$SCRIPT_DIR/verify-appcast.sh" | grep -q "All appcast checks passed"; then
    echo -e "${GREEN}✅ Appcast verification passed${NC}"
else
    echo -e "${YELLOW}⚠️  Some appcast issues detected. Please review the output above.${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Release Complete!${NC}"
echo "=================="
echo ""
echo -e "${GREEN}✅ Successfully released VibeTunnel $RELEASE_VERSION${NC}"
echo ""
echo "Release details:"
echo "  - Version: $RELEASE_VERSION"
echo "  - Build: $BUILD_NUMBER"
echo "  - Tag: $TAG_NAME"
echo "  - GitHub: https://github.com/amantus-ai/vibetunnel/releases/tag/$TAG_NAME"
echo ""
echo "Release artifacts:"
echo "  - DMG: $(basename "$DMG_PATH")"
echo "  - ZIP: $(basename "$ZIP_PATH")"
echo ""

if [[ "$RELEASE_TYPE" != "stable" ]]; then
    echo "📝 Note: This is a pre-release. Users with 'Include Pre-releases' enabled will receive this update."
else
    echo "📝 Note: This is a stable release. All users will receive this update."
fi

echo ""
echo "💡 Next steps:"
echo "  - Test the update from an older version"
echo "  - Monitor Console.app for any update errors"
echo "  - Update release notes on GitHub if needed"