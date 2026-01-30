#!/bin/bash

# =============================================================================
# VibeTunnel Appcast Update Script
# =============================================================================
#
# This script updates the appcast files after a release has been created.
# It fetches release information from GitHub and regenerates the appcast XML.
#
# USAGE:
#   ./scripts/update-appcast.sh
#
# DEPENDENCIES:
#   - GitHub CLI (gh) authenticated
#   - Sparkle tools (sign_update) in ~/.local/bin
#   - generate-appcast.sh script
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

echo -e "${BLUE}🔄 VibeTunnel Appcast Update${NC}"
echo "============================"

# Check GitHub CLI authentication
if ! gh auth status &>/dev/null; then
    echo -e "${RED}❌ Error: GitHub CLI not authenticated${NC}"
    echo "Run: gh auth login"
    exit 1
fi

# Check for Sparkle tools
if ! command -v sign_update &>/dev/null; then
    export PATH="$HOME/.local/bin:$PATH"
    if ! command -v sign_update &>/dev/null; then
        echo -e "${RED}❌ Error: sign_update not found in PATH${NC}"
        echo "Please install Sparkle tools to ~/.local/bin/"
        exit 1
    fi
fi

# Set Sparkle account
export SPARKLE_ACCOUNT="VibeTunnel"
echo "Using Sparkle account: $SPARKLE_ACCOUNT"

# Run generate-appcast.sh
echo ""
echo -e "${BLUE}📋 Generating appcast files...${NC}"
if "$SCRIPT_DIR/generate-appcast.sh"; then
    echo -e "${GREEN}✅ Appcast generation completed${NC}"
else
    echo -e "${RED}❌ Appcast generation failed${NC}"
    exit 1
fi

# Verify appcast files exist
APPCAST_STABLE="$PROJECT_ROOT/../appcast.xml"
APPCAST_PRERELEASE="$PROJECT_ROOT/../appcast-prerelease.xml"

if [[ ! -f "$APPCAST_STABLE" ]]; then
    echo -e "${YELLOW}⚠️  Warning: appcast.xml not found${NC}"
fi

if [[ ! -f "$APPCAST_PRERELEASE" ]]; then
    echo -e "${YELLOW}⚠️  Warning: appcast-prerelease.xml not found${NC}"
fi

# Check if there are changes to commit
cd "$PROJECT_ROOT/.."
if git diff --quiet appcast*.xml 2>/dev/null; then
    echo ""
    echo "ℹ️  No changes to appcast files"
else
    echo ""
    echo -e "${BLUE}📤 Committing appcast changes...${NC}"
    
    # Show what changed
    echo "Changes detected:"
    git diff --stat appcast*.xml
    
    # Add and commit
    git add appcast*.xml
    git commit -m "Update appcast files"
    
    # Push changes
    echo "Pushing changes..."
    git push origin main
    
    echo -e "${GREEN}✅ Appcast changes committed and pushed${NC}"
fi

# Run verification
echo ""
echo -e "${BLUE}🔍 Verifying appcast files...${NC}"
if "$SCRIPT_DIR/verify-appcast.sh"; then
    echo -e "${GREEN}✅ Appcast verification passed${NC}"
else
    echo -e "${YELLOW}⚠️  Some appcast issues detected${NC}"
fi

echo ""
echo -e "${GREEN}✅ Appcast update complete!${NC}"