#!/bin/bash

# =============================================================================
# VibeTunnel Pre-flight Check Script
# =============================================================================
#
# This script validates that everything is ready for a VibeTunnel release by
# performing comprehensive checks on git status, build configuration, tools,
# certificates, and the IS_PRERELEASE_BUILD system.
#
# USAGE:
#   ./scripts/preflight-check.sh
#
# VALIDATION CHECKS:
#   - Git repository status (clean working tree, main branch, synced)
#   - Version information and build number validation
#   - Required development tools (Rust, Node.js, GitHub CLI, Sparkle tools)
#   - Code signing certificates and notarization credentials
#   - Sparkle configuration (keys, appcast files)
#   - IS_PRERELEASE_BUILD system configuration
#
# EXIT CODES:
#   0  All checks passed - ready to release
#   1  Some checks failed - fix issues before releasing
#
# DEPENDENCIES:
#   - git (repository management)
#   - cargo/rustup (Rust toolchain)
#   - node/pnpm (web frontend build)
#   - gh (GitHub CLI)
#   - sign_update (Sparkle EdDSA signing)
#   - xcbeautify (optional, build output formatting)
#   - security (keychain access for certificates)
#   - xmllint (appcast validation)
#
# ENVIRONMENT VARIABLES:
#   APP_STORE_CONNECT_API_KEY_P8    App Store Connect API key (for notarization)
#   APP_STORE_CONNECT_KEY_ID        API Key ID
#   APP_STORE_CONNECT_ISSUER_ID     API Key Issuer ID
#
# EXAMPLES:
#   ./scripts/preflight-check.sh
#
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Track if any checks fail
CHECKS_PASSED=true

echo "🔍 VibeTunnel Release Pre-flight Check"
echo "===================================="
echo ""

# Function to print check results
check_pass() {
    echo -e "${GREEN}✅ PASS${NC}: $1"
}

check_fail() {
    echo -e "${RED}❌ FAIL${NC}: $1"
    CHECKS_PASSED=false
}

check_warn() {
    echo -e "${YELLOW}⚠️  WARN${NC}: $1"
}

# 1. Check Git status
echo "📌 Git Status:"
# Refresh the index to avoid false positives
git update-index --refresh >/dev/null 2>&1 || true
if git diff-index --quiet HEAD -- 2>/dev/null; then
    check_pass "Working directory is clean"
else
    check_fail "Uncommitted changes detected"
    git status --short
fi

# Check if on main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" == "main" ]]; then
    check_pass "On main branch"
else
    check_warn "Not on main branch (current: $CURRENT_BRANCH)"
fi

# Check if up to date with remote
git fetch origin main --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [[ "$LOCAL" == "$REMOTE" ]]; then
    check_pass "Up to date with origin/main"
else
    check_fail "Not synced with origin/main"
fi

echo ""

# 2. Check version information
echo "📌 Version Information:"
VERSION_CONFIG="$PROJECT_ROOT/VibeTunnel/version.xcconfig"
if [[ -f "$VERSION_CONFIG" ]]; then
    MARKETING_VERSION=$(grep 'MARKETING_VERSION' "$VERSION_CONFIG" | sed 's/.*MARKETING_VERSION = //')
    BUILD_NUMBER=$(grep 'CURRENT_PROJECT_VERSION' "$VERSION_CONFIG" | sed 's/.*CURRENT_PROJECT_VERSION = //')
    
    echo "   Marketing Version: $MARKETING_VERSION"
    echo "   Build Number: $BUILD_NUMBER"
    
    check_pass "Version configuration found in version.xcconfig"
else
    check_fail "Version configuration file not found at $VERSION_CONFIG"
    MARKETING_VERSION=""
    BUILD_NUMBER=""
fi

# Check for existing pre-release suffix in version
if [[ -n "$MARKETING_VERSION" ]] && [[ "$MARKETING_VERSION" =~ -([a-zA-Z]+)\.([0-9]+)$ ]]; then
    SUFFIX_TYPE="${BASH_REMATCH[1]}"
    SUFFIX_NUMBER="${BASH_REMATCH[2]}"
    check_warn "Version already contains pre-release suffix: $MARKETING_VERSION"
    echo "   Pre-release type: $SUFFIX_TYPE"
    echo "   Pre-release number: $SUFFIX_NUMBER"
    echo "   ⚠️  Make sure to use matching arguments with release.sh"
    echo "   Example: ./scripts/release.sh $SUFFIX_TYPE $SUFFIX_NUMBER"
fi

echo ""

# 3. Check build numbers
echo "📌 Build Number Validation:"
USED_BUILD_NUMBERS=""
if [[ -f "$PROJECT_ROOT/../appcast.xml" ]]; then
    APPCAST_BUILDS=$(grep -E '<sparkle:version>[0-9]+</sparkle:version>' "$PROJECT_ROOT/../appcast.xml" 2>/dev/null | sed 's/.*<sparkle:version>\([0-9]*\)<\/sparkle:version>.*/\1/' | tr '\n' ' ' || true)
    USED_BUILD_NUMBERS+="$APPCAST_BUILDS"
fi
if [[ -f "$PROJECT_ROOT/../appcast-prerelease.xml" ]]; then
    PRERELEASE_BUILDS=$(grep -E '<sparkle:version>[0-9]+</sparkle:version>' "$PROJECT_ROOT/../appcast-prerelease.xml" 2>/dev/null | sed 's/.*<sparkle:version>\([0-9]*\)<\/sparkle:version>.*/\1/' | tr '\n' ' ' || true)
    USED_BUILD_NUMBERS+="$PRERELEASE_BUILDS"
fi

# Find highest build number
HIGHEST_BUILD=0
for EXISTING_BUILD in $USED_BUILD_NUMBERS; do
    if [[ "$EXISTING_BUILD" -gt "$HIGHEST_BUILD" ]]; then
        HIGHEST_BUILD=$EXISTING_BUILD
    fi
done

if [[ -z "$USED_BUILD_NUMBERS" ]]; then
    check_pass "No existing builds found"
else
    echo "   Existing builds: $USED_BUILD_NUMBERS"
    echo "   Highest build: $HIGHEST_BUILD"
    
    # Check for duplicates
    for EXISTING_BUILD in $USED_BUILD_NUMBERS; do
        if [[ "$BUILD_NUMBER" == "$EXISTING_BUILD" ]]; then
            check_fail "Build number $BUILD_NUMBER already exists!"
        fi
    done
    
    # Check if monotonically increasing
    if [[ "$BUILD_NUMBER" -gt "$HIGHEST_BUILD" ]]; then
        check_pass "Build number $BUILD_NUMBER is valid (> $HIGHEST_BUILD)"
    else
        check_fail "Build number must be > $HIGHEST_BUILD"
    fi
fi

echo ""

# Check if Xcode project uses version.xcconfig
echo "📌 Xcode Project Configuration:"
XCODEPROJ="$PROJECT_ROOT/VibeTunnel.xcodeproj/project.pbxproj"
if [[ -f "$XCODEPROJ" ]]; then
    if grep -q "version.xcconfig" "$XCODEPROJ"; then
        check_pass "Xcode project references version.xcconfig"
        
        # Check if MARKETING_VERSION uses variable expansion
        if grep -q 'MARKETING_VERSION = "$(MARKETING_VERSION)"' "$XCODEPROJ"; then
            check_pass "MARKETING_VERSION uses version.xcconfig value"
        else
            check_warn "MARKETING_VERSION may not use version.xcconfig value"
            echo "   Consider updating to: MARKETING_VERSION = \"\$(MARKETING_VERSION)\""
        fi
        
        # Check if CURRENT_PROJECT_VERSION uses variable expansion  
        if grep -q 'CURRENT_PROJECT_VERSION = "$(CURRENT_PROJECT_VERSION)"' "$XCODEPROJ" || grep -q 'CURRENT_PROJECT_VERSION = $(CURRENT_PROJECT_VERSION)' "$XCODEPROJ"; then
            check_pass "CURRENT_PROJECT_VERSION uses version.xcconfig value"
        else
            check_warn "CURRENT_PROJECT_VERSION may not use version.xcconfig value"
            echo "   Consider updating to use version.xcconfig"
        fi
    else
        check_fail "Xcode project doesn't reference version.xcconfig - versions may not match!"
    fi
else
    check_fail "Xcode project file not found"
fi

echo ""

# 4. Check required tools
echo "📌 Required Tools:"

# Rust toolchain
if command -v cargo &> /dev/null; then
    check_pass "Rust toolchain installed"
else
    check_fail "Rust not installed - visit https://rustup.rs"
fi

# Node.js
if command -v node &> /dev/null; then
    check_pass "Node.js installed"
else
    check_fail "Node.js not installed - required for web frontend build"
fi

# GitHub CLI
if command -v gh &> /dev/null; then
    check_pass "GitHub CLI (gh) installed"
    if gh auth status &> /dev/null; then
        check_pass "GitHub CLI authenticated"
    else
        check_fail "GitHub CLI not authenticated - run: gh auth login"
    fi
else
    check_fail "GitHub CLI not installed - run: brew install gh"
fi


# Sparkle tools
if [[ -f "$HOME/.local/bin/sign_update" ]]; then
    check_pass "Sparkle sign_update installed"
else
    check_fail "Sparkle tools not installed - see RELEASE.md"
fi

# xcbeautify (optional but recommended)
if command -v xcbeautify &> /dev/null; then
    check_pass "xcbeautify installed"
else
    check_warn "xcbeautify not installed (optional) - run: brew install xcbeautify"
fi

echo ""

# 5. Check signing configuration
echo "📌 Signing Configuration:"

# Check for Developer ID certificate
if security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
    check_pass "Developer ID certificate found"
else
    check_fail "No Developer ID certificate found"
fi

# Check for notarization credentials
if [[ -n "${APP_STORE_CONNECT_API_KEY_P8:-}" ]]; then
    check_pass "Notarization API key configured"
else
    check_warn "Notarization API key not in environment"
fi

echo ""

# 6. Check Sparkle configuration
echo "📌 Sparkle Configuration:"

# Check public key
PUBLIC_KEY_FILE="$PROJECT_ROOT/VibeTunnel/sparkle-public-ed-key.txt"
if [[ -f "$PUBLIC_KEY_FILE" ]]; then
    PUBLIC_KEY=$(cat "$PUBLIC_KEY_FILE" | tr -d '\n')
    if [[ -n "$PUBLIC_KEY" ]]; then
        check_pass "Sparkle public key configured"
    else
        check_fail "Sparkle public key file is empty"
    fi
else
    check_fail "Sparkle public key file not found at $PUBLIC_KEY_FILE"
fi

# Check private key in keychain
export PATH="$HOME/.local/bin:$PATH"
if command -v generate_keys &> /dev/null && generate_keys -p &>/dev/null; then
    check_pass "Sparkle private key found in Keychain"
else
    check_fail "Sparkle private key not found in Keychain - run: generate_keys"
fi

echo ""

# 7. Check appcast files
echo "📌 Appcast Files:"

if [[ -f "$PROJECT_ROOT/../appcast.xml" ]]; then
    if xmllint --noout "$PROJECT_ROOT/../appcast.xml" 2>/dev/null; then
        check_pass "appcast.xml is valid XML"
    else
        check_fail "appcast.xml has XML errors"
    fi
else
    check_warn "appcast.xml not found (OK if no stable releases yet)"
fi

if [[ -f "$PROJECT_ROOT/../appcast-prerelease.xml" ]]; then
    if xmllint --noout "$PROJECT_ROOT/../appcast-prerelease.xml" 2>/dev/null; then
        check_pass "appcast-prerelease.xml is valid XML"
    else
        check_fail "appcast-prerelease.xml has XML errors"
    fi
else
    check_warn "appcast-prerelease.xml not found (OK if no pre-releases yet)"
fi

echo ""

# 8. Check IS_PRERELEASE_BUILD Configuration
echo "📌 IS_PRERELEASE_BUILD System:"

# Check if IS_PRERELEASE_BUILD is configured in Info.plist
if grep -q 'IS_PRERELEASE_BUILD' "$PROJECT_ROOT/VibeTunnel-Info.plist" || grep -q 'IS_PRERELEASE_BUILD' "$PROJECT_ROOT/VibeTunnel/Info.plist" 2>/dev/null; then
    check_pass "IS_PRERELEASE_BUILD flag configured in Info.plist"
else
    check_warn "IS_PRERELEASE_BUILD flag not found in Info.plist (will be set at build time)"
fi

# Check if UpdateChannel.swift has the flag detection logic
if grep -q "Bundle.main.object.*IS_PRERELEASE_BUILD" "$PROJECT_ROOT/VibeTunnel/Core/Models/UpdateChannel.swift"; then
    check_pass "UpdateChannel has IS_PRERELEASE_BUILD detection logic"
else
    check_fail "UpdateChannel.swift missing IS_PRERELEASE_BUILD flag detection"
fi

# Check if release script sets the environment variable
if grep -q "export IS_PRERELEASE_BUILD=" "$PROJECT_ROOT/scripts/release.sh"; then
    check_pass "Release script sets IS_PRERELEASE_BUILD environment variable"
else
    check_fail "Release script missing IS_PRERELEASE_BUILD environment variable setup"
fi

# Check if AppBehaviorSettingsManager uses defaultChannel
APP_BEHAVIOR_SETTINGS="$PROJECT_ROOT/VibeTunnel/Core/Services/Settings/AppBehaviorSettingsManager.swift"
if [[ -f "$APP_BEHAVIOR_SETTINGS" ]]; then
    if grep -q "UpdateChannel.defaultChannel" "$APP_BEHAVIOR_SETTINGS"; then
        check_pass "AppBehaviorSettingsManager uses UpdateChannel.defaultChannel()"
    else
        check_fail "AppBehaviorSettingsManager not using UpdateChannel.defaultChannel() for auto-detection"
    fi
else
    check_warn "AppBehaviorSettingsManager.swift not found - skipping UpdateChannel check"
fi

echo ""

# 9. Summary
echo "📊 Pre-flight Summary:"
echo "===================="

if [[ "$CHECKS_PASSED" == true ]]; then
    echo -e "${GREEN}✅ All critical checks passed!${NC}"
    echo ""
    echo "Ready to release:"
    echo "  Version: $MARKETING_VERSION"
    echo "  Build: $BUILD_NUMBER"
    echo ""
    echo "Next steps:"
    echo "  - For beta: ./scripts/release.sh beta 1"
    echo "  - For stable: ./scripts/release.sh stable"
    exit 0
else
    echo -e "${RED}❌ Some checks failed. Please fix the issues above.${NC}"
    exit 1
fi