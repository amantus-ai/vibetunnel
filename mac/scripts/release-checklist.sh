#!/bin/bash
#
# Release Checklist Script for VibeTunnel
# 
# This script provides an interactive checklist to ensure all release
# requirements are met before and during the release process.
#
# Usage: ./scripts/release-checklist.sh [version]
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Icons
CHECK="✓"
CROSS="✗"
WARN="⚠"
INFO="ℹ"

# Version argument (optional)
VERSION="${1:-}"

# Function to print colored output
print_header() {
    echo -e "\n${BLUE}=== $1 ===${NC}\n"
}

print_success() {
    echo -e "${GREEN}${CHECK} $1${NC}"
}

print_error() {
    echo -e "${RED}${CROSS} $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}${WARN} $1${NC}"
}

print_info() {
    echo -e "${BLUE}${INFO} $1${NC}"
}

# Function to prompt for confirmation
confirm() {
    local prompt="$1"
    local response
    
    echo -en "${YELLOW}$prompt (y/n): ${NC}"
    read -r response
    [[ "$response" =~ ^[Yy]$ ]]
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check file exists
file_exists() {
    [ -f "$1" ]
}

# Function to check directory exists
dir_exists() {
    [ -d "$1" ]
}

# Function to get current version from version.xcconfig
get_current_version() {
    grep "MARKETING_VERSION" "$PROJECT_ROOT/VibeTunnel/version.xcconfig" | cut -d'=' -f2 | tr -d ' '
}

# Function to get current build number
get_current_build() {
    grep "CURRENT_PROJECT_VERSION" "$PROJECT_ROOT/VibeTunnel/version.xcconfig" | cut -d'=' -f2 | tr -d ' '
}

# Function to check if on main branch
check_main_branch() {
    local current_branch=$(git branch --show-current)
    [ "$current_branch" = "main" ]
}

# Function to check for uncommitted changes
check_git_clean() {
    [ -z "$(git status --porcelain)" ]
}

# Function to check if release already exists
check_release_exists() {
    local version="$1"
    gh release view "v$version" >/dev/null 2>&1
}

# Main checklist
main() {
    echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║    VibeTunnel Release Checklist v1.0       ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
    
    # Get version info
    local current_version=$(get_current_version)
    local current_build=$(get_current_build)
    
    if [ -z "$VERSION" ]; then
        VERSION="$current_version"
    fi
    
    print_info "Checking release readiness for version: $VERSION"
    print_info "Current version.xcconfig: $current_version (build $current_build)"
    
    local checks_passed=0
    local total_checks=0
    
    # ========================================
    print_header "1. Environment & Tools"
    # ========================================
    
    # Check Xcode
    ((total_checks++))
    if command_exists xcodebuild; then
        print_success "Xcode is installed"
        ((checks_passed++))
    else
        print_error "Xcode is not installed"
    fi
    
    # Check GitHub CLI
    ((total_checks++))
    if command_exists gh; then
        if gh auth status >/dev/null 2>&1; then
            print_success "GitHub CLI is authenticated"
            ((checks_passed++))
        else
            print_error "GitHub CLI is not authenticated (run: gh auth login)"
        fi
    else
        print_error "GitHub CLI is not installed"
    fi
    
    # Check Sparkle tools
    ((total_checks++))
    if command_exists sign_update || [ -f "$HOME/.local/bin/sign_update" ]; then
        print_success "Sparkle tools are available"
        ((checks_passed++))
    else
        print_error "Sparkle tools not found (sign_update)"
    fi
    
    # Check Node.js
    ((total_checks++))
    if command_exists node; then
        print_success "Node.js is installed"
        ((checks_passed++))
    else
        print_error "Node.js is not installed"
    fi
    
    # Check Bun
    ((total_checks++))
    if command_exists bun; then
        print_success "Bun is installed"
        ((checks_passed++))
    else
        print_error "Bun is not installed"
    fi
    
    # ========================================
    print_header "2. Version Configuration"
    # ========================================
    
    # Check version consistency
    ((total_checks++))
    if [ "$VERSION" = "$current_version" ]; then
        print_success "Target version matches version.xcconfig"
        ((checks_passed++))
    else
        print_warning "Target version ($VERSION) differs from version.xcconfig ($current_version)"
        if confirm "Is this intentional?"; then
            ((checks_passed++))
        fi
    fi
    
    # Check web package.json version
    ((total_checks++))
    local web_version=$(grep '"version"' "$PROJECT_ROOT/../web/package.json" | cut -d'"' -f4)
    local base_web_version="${web_version%-*}"  # Remove pre-release suffix
    local base_current_version="${current_version%-*}"  # Remove pre-release suffix
    
    if [ "$base_web_version" = "$base_current_version" ]; then
        print_success "Web package.json version matches ($web_version)"
        ((checks_passed++))
    else
        print_error "Web package.json version ($web_version) doesn't match app version ($current_version)"
    fi
    
    # Check if this is a pre-release
    if [[ "$VERSION" =~ -(beta|alpha|rc)\. ]]; then
        print_info "This is a pre-release version"
    else
        print_info "This is a stable release version"
    fi
    
    # ========================================
    print_header "3. Git Repository Status"
    # ========================================
    
    # Check branch
    ((total_checks++))
    if check_main_branch; then
        print_success "On main branch"
        ((checks_passed++))
    else
        print_error "Not on main branch (current: $(git branch --show-current))"
    fi
    
    # Check for uncommitted changes
    ((total_checks++))
    if check_git_clean; then
        print_success "No uncommitted changes"
        ((checks_passed++))
    else
        print_warning "Uncommitted changes detected:"
        git status --short
        if confirm "Continue anyway?"; then
            ((checks_passed++))
        fi
    fi
    
    # Check if release already exists
    ((total_checks++))
    if check_release_exists "$VERSION"; then
        print_error "Release v$VERSION already exists on GitHub"
    else
        print_success "Release v$VERSION does not exist yet"
        ((checks_passed++))
    fi
    
    # ========================================
    print_header "4. Critical Files"
    # ========================================
    
    # Check CHANGELOG.md
    ((total_checks++))
    local changelog_found=false
    local changelog_location=""
    
    if file_exists "$PROJECT_ROOT/CHANGELOG.md"; then
        changelog_found=true
        changelog_location="$PROJECT_ROOT/CHANGELOG.md"
    elif file_exists "$PROJECT_ROOT/../CHANGELOG.md"; then
        changelog_found=true
        changelog_location="$PROJECT_ROOT/../CHANGELOG.md"
    fi
    
    if [ "$changelog_found" = true ]; then
        if grep -q "## \[$VERSION\]" "$changelog_location" 2>/dev/null; then
            print_success "CHANGELOG.md has entry for version $VERSION"
            ((checks_passed++))
        else
            print_error "CHANGELOG.md missing entry for version $VERSION"
        fi
    else
        print_error "CHANGELOG.md not found"
    fi
    
    # Check Sparkle private key (clean version)
    ((total_checks++))
    if file_exists "$PROJECT_ROOT/private/sparkle_ed_private_key"; then
        print_success "Clean Sparkle private key exists"
        ((checks_passed++))
    elif file_exists "$PROJECT_ROOT/private/sparkle_private_key"; then
        print_warning "Only commented private key exists - clean version will be created"
        ((checks_passed++))
    else
        print_error "No Sparkle private key found"
    fi
    
    # Check version.xcconfig
    ((total_checks++))
    if file_exists "$PROJECT_ROOT/VibeTunnel/version.xcconfig"; then
        print_success "version.xcconfig exists"
        ((checks_passed++))
    else
        print_error "version.xcconfig not found"
    fi
    
    # ========================================
    print_header "5. Build Configuration"
    # ========================================
    
    # Check for custom Node.js build
    ((total_checks++))
    if dir_exists "$PROJECT_ROOT/../web/.node-builds"; then
        print_success "Custom Node.js build directory exists"
        print_info "Note: If custom Node.js not found, will fall back to system Node.js"
        ((checks_passed++))
    else
        print_warning "No custom Node.js build directory"
        print_info "Release will use system Node.js (larger app size)"
        ((checks_passed++))
    fi
    
    # Check for stuck DMG volumes
    ((total_checks++))
    if ls /Volumes/VibeTunnel* >/dev/null 2>&1; then
        print_warning "Stuck DMG volumes detected"
        if confirm "Unmount them?"; then
            for volume in /Volumes/VibeTunnel*; do
                hdiutil detach "$volume" -force 2>/dev/null || true
            done
            print_success "Volumes unmounted"
        fi
        ((checks_passed++))
    else
        print_success "No stuck DMG volumes"
        ((checks_passed++))
    fi
    
    # ========================================
    print_header "6. Environment Variables"
    # ========================================
    
    # Check SPARKLE_ACCOUNT
    ((total_checks++))
    if [ -n "${SPARKLE_ACCOUNT:-}" ]; then
        print_success "SPARKLE_ACCOUNT is set: $SPARKLE_ACCOUNT"
        ((checks_passed++))
    else
        print_warning "SPARKLE_ACCOUNT not set"
        print_info "Run: export SPARKLE_ACCOUNT=\"VibeTunnel\""
        ((checks_passed++))
    fi
    
    # Check notarization credentials
    ((total_checks++))
    local notary_ok=true
    if [ -z "${APP_STORE_CONNECT_KEY_ID:-}" ]; then
        print_warning "APP_STORE_CONNECT_KEY_ID not set"
        notary_ok=false
    fi
    if [ -z "${APP_STORE_CONNECT_ISSUER_ID:-}" ]; then
        print_warning "APP_STORE_CONNECT_ISSUER_ID not set"
        notary_ok=false
    fi
    if [ -z "${APP_STORE_CONNECT_API_KEY_P8:-}" ]; then
        print_warning "APP_STORE_CONNECT_API_KEY_P8 not set"
        notary_ok=false
    fi
    
    if [ "$notary_ok" = true ]; then
        print_success "Notarization credentials are set"
        ((checks_passed++))
    else
        print_error "Missing notarization credentials"
    fi
    
    # ========================================
    print_header "7. Release State"
    # ========================================
    
    # Check for existing release state
    ((total_checks++))
    if file_exists "$PROJECT_ROOT/.release-state"; then
        print_warning "Previous release state found"
        print_info "Use './scripts/release.sh --status' to check"
        print_info "Use './scripts/release.sh --resume' to continue"
        if confirm "Clear previous state?"; then
            rm -f "$PROJECT_ROOT/.release-state"
            print_success "State cleared"
        fi
        ((checks_passed++))
    else
        print_success "No previous release state"
        ((checks_passed++))
    fi
    
    # ========================================
    print_header "Summary"
    # ========================================
    
    local percentage=$((checks_passed * 100 / total_checks))
    
    echo
    echo -e "Checks passed: ${GREEN}$checks_passed${NC} / $total_checks ($percentage%)"
    echo
    
    if [ "$checks_passed" -eq "$total_checks" ]; then
        print_success "All checks passed! Ready to release."
        echo
        echo "Next steps:"
        echo "1. Run: export SPARKLE_ACCOUNT=\"VibeTunnel\""
        echo "2. Run: ./scripts/release.sh [release-type] [number]"
        echo "3. Monitor the release process"
        echo "4. If interrupted, use: ./scripts/release.sh --resume"
    else
        print_warning "Some checks need attention."
        echo
        echo "Please address the issues above before proceeding with the release."
    fi
    
    # ========================================
    print_header "Quick Commands Reference"
    # ========================================
    
    echo "# Set up environment:"
    echo "export SPARKLE_ACCOUNT=\"VibeTunnel\""
    echo
    echo "# Check versions:"
    echo "grep MARKETING_VERSION VibeTunnel/version.xcconfig"
    echo "grep CURRENT_PROJECT_VERSION VibeTunnel/version.xcconfig"
    echo
    echo "# Run release:"
    echo "./scripts/release.sh stable          # For stable release"
    echo "./scripts/release.sh beta 10         # For beta.10"
    echo "./scripts/release.sh --resume        # Resume interrupted release"
    echo "./scripts/release.sh --status        # Check release status"
    echo
    echo "# If release fails, manual recovery:"
    echo "./scripts/build.sh --configuration Release"
    echo "./scripts/sign-and-notarize.sh build/Build/Products/Release/VibeTunnel.app"
    echo "./scripts/create-dmg.sh build/Build/Products/Release/VibeTunnel.app"
    echo "gh release create \"v$VERSION\" --title \"VibeTunnel $VERSION\" --prerelease build/VibeTunnel-*.dmg"
    echo
}

# Run main function
main "$@"