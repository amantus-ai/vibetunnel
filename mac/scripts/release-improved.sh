#!/bin/bash
#
# Improved release script with better state tracking and progress indicators
#
# This script automates the entire release process for VibeTunnel:
# 1. Pre-flight checks
# 2. Clean build directory
# 3. Set version
# 4. Build application
# 5. Sign and notarize
# 6. Create DMG and ZIP
# 7. Create GitHub release
# 8. Update appcast
# 9. Commit and push
#

set -eo pipefail

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."

# Source required scripts
source "$SCRIPT_DIR/release-state.sh"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Progress tracking
STEP_START_TIME=""

start_step() {
    local step_num=$1
    local step_name=$2
    STEP_START_TIME=$(date +%s)
    echo ""
    echo -e "${BLUE}📋 Step $step_num/9: $step_name...${NC}"
    update_step "$step_num" "in_progress"
}

complete_step() {
    local step_num=$1
    local step_name=$2
    local duration=$(($(date +%s) - STEP_START_TIME))
    echo -e "${GREEN}✅ $step_name completed (${duration}s)${NC}"
    update_step "$step_num" "completed"
}

fail_step() {
    local step_num=$1
    local step_name=$2
    local error_msg=$3
    echo -e "${RED}❌ $step_name failed: $error_msg${NC}"
    update_step "$step_num" "failed"
    exit 1
}

# Show progress with timeout warnings
show_progress() {
    local operation=$1
    local timeout_warning=${2:-300}  # Default 5 minutes
    local start_time=$(date +%s)
    local warned=false
    
    while true; do
        local elapsed=$(($(date +%s) - start_time))
        
        # Show timeout warning
        if [[ $elapsed -gt $timeout_warning ]] && [[ "$warned" == "false" ]]; then
            echo -e "${YELLOW}⏰ $operation is taking longer than expected (>${timeout_warning}s)...${NC}"
            warned=true
        fi
        
        # Check if process is still running
        if ! jobs %1 &>/dev/null; then
            break
        fi
        
        # Update progress indicator
        printf "."
        sleep 5
    done
    echo ""  # New line after dots
}

# Parse command line arguments
RELEASE_TYPE=""
RELEASE_NUMBER=""
DRY_RUN=false
RESUME=false
SHOW_STATUS=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --resume)
            RESUME=true
            shift
            ;;
        --status)
            SHOW_STATUS=true
            shift
            ;;
        stable|beta|alpha|rc)
            RELEASE_TYPE=$1
            shift
            if [[ $# -gt 0 && ! "$1" =~ ^-- ]]; then
                RELEASE_NUMBER=$1
                shift
            fi
            ;;
        *)
            echo -e "${RED}❌ Unknown argument: $1${NC}"
            exit 1
            ;;
    esac
done

# Show status if requested
if [[ "$SHOW_STATUS" == "true" ]]; then
    show_release_status
    exit 0
fi

# Main release process
if [[ "$RESUME" == "true" ]]; then
    echo -e "${BLUE}📋 Resuming release${NC}"
    # Load state and continue from last step
    if [[ ! -f "$PROJECT_ROOT/.release-state.json" ]]; then
        echo -e "${RED}❌ No release state found to resume${NC}"
        exit 1
    fi
    
    # Check if release is stale (>2 hours old)
    LAST_UPDATED=$(jq -r '.last_updated // empty' "$PROJECT_ROOT/.release-state.json")
    if [[ -n "$LAST_UPDATED" ]]; then
        LAST_TIMESTAMP=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$LAST_UPDATED" +%s 2>/dev/null || date -d "$LAST_UPDATED" +%s)
        CURRENT_TIMESTAMP=$(date +%s)
        AGE=$((CURRENT_TIMESTAMP - LAST_TIMESTAMP))
        
        if [[ $AGE -gt 7200 ]]; then  # 2 hours
            echo -e "${YELLOW}⚠️  Release state is over 2 hours old${NC}"
            echo "Continue anyway? (y/n): "
            read -r response
            if [[ "$response" != "y" ]]; then
                exit 1
            fi
        fi
    fi
    
    CURRENT_STEP=$(get_current_step)
    echo "Resuming from step $CURRENT_STEP..."
else
    # Validate release type and number
    if [[ -z "$RELEASE_TYPE" ]]; then
        show_usage
        exit 1
    fi
    
    if [[ "$RELEASE_TYPE" != "stable" ]] && [[ -z "$RELEASE_NUMBER" ]]; then
        echo -e "${RED}❌ Error: Pre-release number is required for $RELEASE_TYPE releases${NC}"
        exit 1
    fi
    
    # Initialize state
    RELEASE_VERSION=$(get_release_version "$RELEASE_TYPE" "$RELEASE_NUMBER")
    BUILD_NUMBER=$(get_build_number)
    TAG_NAME="v$RELEASE_VERSION"
    
    init_state "$RELEASE_TYPE" "$RELEASE_VERSION" "$BUILD_NUMBER" "$TAG_NAME"
    CURRENT_STEP=1
fi

# Execute steps based on current progress
echo -e "${BLUE}🚀 VibeTunnel Release Process${NC}"
echo "=================================="

# Step 1: Pre-flight check
if [[ $(get_current_step) -le 1 ]]; then
    start_step 1 "Pre-flight check"
    
    # Run the preflight check
    if ! "$SCRIPT_DIR/preflight-check.sh"; then
        fail_step 1 "Pre-flight check" "Pre-flight checks failed"
    fi
    
    complete_step 1 "Pre-flight check"
fi

# Step 2: Clean build
if [[ $(get_current_step) -le 2 ]]; then
    start_step 2 "Clean build directory"
    
    "$SCRIPT_DIR/clean.sh" || fail_step 2 "Clean build" "Failed to clean build directory"
    
    complete_step 2 "Clean build directory"
fi

# Step 3: Set version
if [[ $(get_current_step) -le 3 ]]; then
    start_step 3 "Set version"
    
    # Version should already be set in version.xcconfig
    echo "Version: $RELEASE_VERSION"
    echo "Build: $BUILD_NUMBER"
    
    complete_step 3 "Set version"
fi

# Step 4: Build application
if [[ $(get_current_step) -le 4 ]]; then
    start_step 4 "Build application"
    
    # Build with progress tracking
    (
        export CI=${CI:-false}
        export SKIP_NODE_CHECK=${SKIP_NODE_CHECK:-false}
        export IS_PRERELEASE_BUILD=$([[ "$RELEASE_TYPE" != "stable" ]] && echo "true" || echo "false")
        "$SCRIPT_DIR/build.sh" --configuration Release
    ) &
    
    show_progress "Building application" 600  # 10 minute warning
    wait $! || fail_step 4 "Build application" "Build failed"
    
    complete_step 4 "Build application"
fi

# Step 5: Sign and notarize
if [[ $(get_current_step) -le 5 ]]; then
    start_step 5 "Sign and notarize"
    
    APP_PATH="$PROJECT_ROOT/build/Build/Products/Release/VibeTunnel.app"
    
    # Sign and notarize with progress tracking
    "$SCRIPT_DIR/sign-and-notarize.sh" "$APP_PATH" &
    show_progress "Notarization" 600  # 10 minute warning
    wait $! || fail_step 5 "Sign and notarize" "Notarization failed"
    
    # Update artifact path
    update_artifact "app_path" "$APP_PATH"
    
    complete_step 5 "Sign and notarize"
fi

# Step 6: Create DMG and ZIP
if [[ $(get_current_step) -le 6 ]]; then
    start_step 6 "Create DMG and ZIP"
    
    DMG_PATH="$PROJECT_ROOT/build/VibeTunnel-$RELEASE_VERSION.dmg"
    ZIP_PATH="$PROJECT_ROOT/build/VibeTunnel-$RELEASE_VERSION.zip"
    
    # Create DMG
    "$SCRIPT_DIR/create-dmg.sh" "$APP_PATH" || fail_step 6 "Create DMG" "DMG creation failed"
    
    # Create ZIP
    "$SCRIPT_DIR/create-zip.sh" "$APP_PATH" || fail_step 6 "Create ZIP" "ZIP creation failed"
    
    # Update artifact paths
    update_artifact "dmg_path" "$DMG_PATH"
    update_artifact "zip_path" "$ZIP_PATH"
    
    complete_step 6 "Create DMG and ZIP"
fi

# Step 7: GitHub release
if [[ $(get_current_step) -le 7 ]]; then
    start_step 7 "GitHub release"
    
    # Generate release notes
    RELEASE_NOTES=$("$SCRIPT_DIR/generate-release-notes.sh" "$RELEASE_VERSION")
    
    # Create GitHub release
    gh release create "$TAG_NAME" \
        --title "VibeTunnel $RELEASE_VERSION" \
        --notes "$RELEASE_NOTES" \
        $([[ "$RELEASE_TYPE" != "stable" ]] && echo "--prerelease") \
        "$DMG_PATH" \
        "$ZIP_PATH" || fail_step 7 "GitHub release" "Failed to create GitHub release"
    
    complete_step 7 "GitHub release"
fi

# Step 8: Update appcast
if [[ $(get_current_step) -le 8 ]]; then
    start_step 8 "Update appcast"
    
    # Sign DMG for Sparkle
    export SPARKLE_ACCOUNT="VibeTunnel"
    SPARKLE_SIG=$(sign_update -f "$PROJECT_ROOT/private/sparkle_ed_private_key" "$DMG_PATH" --account VibeTunnel | grep -o 'sparkle:edSignature="[^"]*"' | cut -d'"' -f2)
    
    if [[ -z "$SPARKLE_SIG" ]]; then
        fail_step 8 "Update appcast" "Failed to sign DMG for Sparkle"
    fi
    
    # Update artifact
    update_artifact "sparkle_signature" "$SPARKLE_SIG"
    
    # Update appcast file
    "$SCRIPT_DIR/update-appcast.sh" "$RELEASE_VERSION" "$BUILD_NUMBER" "$SPARKLE_SIG" || fail_step 8 "Update appcast" "Failed to update appcast"
    
    complete_step 8 "Update appcast"
fi

# Step 9: Commit and push
if [[ $(get_current_step) -le 9 ]]; then
    start_step 9 "Commit and push"
    
    # Add and commit appcast changes
    git add ../appcast*.xml
    git commit -m "Update appcast for v$RELEASE_VERSION" || true  # Ignore if no changes
    git push || fail_step 9 "Commit and push" "Failed to push changes"
    
    complete_step 9 "Commit and push"
fi

# Clean up state file on success
rm -f "$PROJECT_ROOT/.release-state.json"

echo ""
echo -e "${GREEN}🎉 Release $RELEASE_VERSION completed successfully!${NC}"
echo ""
echo "Release artifacts:"
echo "  - GitHub: https://github.com/amantus-ai/vibetunnel/releases/tag/$TAG_NAME"
echo "  - DMG: $DMG_PATH"
echo "  - ZIP: $ZIP_PATH"
echo ""
echo "Users on the $([[ "$RELEASE_TYPE" == "stable" ]] && echo "stable" || echo "pre-release") channel will receive the update via Sparkle."