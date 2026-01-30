#!/bin/bash
#
# Release Health Check
#
# Comprehensive pre-release validation to catch issues early
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Counters
ERRORS=0
WARNINGS=0

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║      VibeTunnel Release Health Check       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# Helper functions
check_pass() {
    echo -e "${GREEN}✅ $1${NC}"
}

check_fail() {
    echo -e "${RED}❌ $1${NC}"
    ((ERRORS++))
}

check_warn() {
    echo -e "${YELLOW}⚠️  $1${NC}"
    ((WARNINGS++))
}

# 1. Git Status
echo -e "${BLUE}1. Git Repository${NC}"
if git diff --quiet && git diff --cached --quiet; then
    check_pass "Working directory clean"
else
    check_fail "Uncommitted changes detected"
fi

BRANCH=$(git branch --show-current)
if [[ "$BRANCH" == "main" ]]; then
    check_pass "On main branch"
else
    check_warn "Not on main branch (current: $BRANCH)"
fi

if git rev-parse '@{u}' &>/dev/null; then
    if git diff '@{u}' --quiet; then
        check_pass "Up to date with remote"
    else
        check_warn "Not synchronized with remote"
    fi
else
    check_warn "No upstream branch set"
fi

# 2. Environment Variables
echo ""
echo -e "${BLUE}2. Environment Variables${NC}"

if [[ -n "${SPARKLE_ACCOUNT:-}" ]]; then
    check_pass "SPARKLE_ACCOUNT is set"
else
    check_warn "SPARKLE_ACCOUNT not set (run: export SPARKLE_ACCOUNT=\"VibeTunnel\")"
fi

if [[ -n "${APP_STORE_CONNECT_KEY_ID:-}" ]] && \
   [[ -n "${APP_STORE_CONNECT_ISSUER_ID:-}" ]] && \
   [[ -n "${APP_STORE_CONNECT_API_KEY_P8:-}" ]]; then
    check_pass "Notarization credentials configured"
else
    check_fail "Notarization credentials missing"
fi

# 3. Tools & Dependencies
echo ""
echo -e "${BLUE}3. Build Tools${NC}"

# Node.js
if "$SCRIPT_DIR/check-node-simple.sh" &>/dev/null; then
    NODE_VERSION=$(node --version 2>/dev/null || echo "unknown")
    check_pass "Node.js found ($NODE_VERSION)"
else
    check_fail "Node.js not properly configured"
fi

# Xcode
if xcodebuild -version &>/dev/null; then
    XCODE_VERSION=$(xcodebuild -version | head -1)
    check_pass "Xcode found ($XCODE_VERSION)"
else
    check_fail "Xcode not found"
fi

# GitHub CLI
if command -v gh &>/dev/null; then
    if gh auth status &>/dev/null; then
        check_pass "GitHub CLI authenticated"
    else
        check_fail "GitHub CLI not authenticated"
    fi
else
    check_fail "GitHub CLI not installed"
fi

# Sparkle tools
if command -v sign_update &>/dev/null; then
    check_pass "Sparkle tools installed"
else
    check_fail "Sparkle sign_update not found"
fi

# 4. Signing & Certificates
echo ""
echo -e "${BLUE}4. Code Signing${NC}"

if security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
    check_pass "Developer ID certificate found"
else
    check_fail "Developer ID certificate not found"
fi

if [[ -f "$PROJECT_ROOT/private/sparkle_ed_private_key" ]]; then
    check_pass "Sparkle private key found"
else
    check_fail "Sparkle private key missing"
fi

# 5. Version Configuration
echo ""
echo -e "${BLUE}5. Version Configuration${NC}"

if [[ -f "$PROJECT_ROOT/VibeTunnel/version.xcconfig" ]]; then
    MARKETING_VERSION=$(grep "MARKETING_VERSION" "$PROJECT_ROOT/VibeTunnel/version.xcconfig" | cut -d= -f2 | tr -d ' ')
    BUILD_NUMBER=$(grep "CURRENT_PROJECT_VERSION" "$PROJECT_ROOT/VibeTunnel/version.xcconfig" | cut -d= -f2 | tr -d ' ')
    check_pass "Version config found: $MARKETING_VERSION (build $BUILD_NUMBER)"
    
    # Check web version sync
    WEB_VERSION=$(grep '"version"' "$PROJECT_ROOT/../web/package.json" | cut -d'"' -f4)
    if [[ "$WEB_VERSION" == "$MARKETING_VERSION" ]]; then
        check_pass "Web version synchronized"
    else
        check_fail "Web version mismatch (web: $WEB_VERSION, mac: $MARKETING_VERSION)"
    fi
else
    check_fail "version.xcconfig not found"
fi

# 6. Disk Space
echo ""
echo -e "${BLUE}6. System Resources${NC}"

AVAILABLE_SPACE=$(df -h . | awk 'NR==2 {print $4}' | sed 's/G.*//')
if [[ $(echo "$AVAILABLE_SPACE > 10" | bc -l) -eq 1 ]]; then
    check_pass "Sufficient disk space (${AVAILABLE_SPACE}GB available)"
else
    check_warn "Low disk space (${AVAILABLE_SPACE}GB available, recommend >10GB)"
fi

# 7. Previous Release State
echo ""
echo -e "${BLUE}7. Release State${NC}"

if [[ -f "$PROJECT_ROOT/.release-state.json" ]]; then
    check_warn "Previous release state found - consider cleaning up"
else
    check_pass "No stale release state"
fi

# 8. Appcast Files
echo ""
echo -e "${BLUE}8. Appcast Configuration${NC}"

if [[ -f "$PROJECT_ROOT/../appcast-prerelease.xml" ]]; then
    if xmllint --noout "$PROJECT_ROOT/../appcast-prerelease.xml" 2>/dev/null; then
        check_pass "Pre-release appcast valid"
    else
        check_fail "Pre-release appcast has XML errors"
    fi
else
    check_fail "Pre-release appcast not found"
fi

# Summary
echo ""
echo -e "${BLUE}════════════════════════════════════════════${NC}"
echo -e "${BLUE}Summary:${NC}"
echo -e "  Errors: ${ERRORS}"
echo -e "  Warnings: ${WARNINGS}"

if [[ $ERRORS -eq 0 ]]; then
    echo ""
    echo -e "${GREEN}✅ System is ready for release!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Set any missing environment variables"
    echo "  2. Run: ./scripts/release.sh beta N"
    exit 0
else
    echo ""
    echo -e "${RED}❌ Please fix the errors above before releasing${NC}"
    exit 1
fi