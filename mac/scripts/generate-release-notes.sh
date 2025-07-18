#!/bin/bash

# =============================================================================
# VibeTunnel Release Notes Generator
# =============================================================================
#
# Generates markdown release notes for a specific version from CHANGELOG.md.
# This script is designed to work in various environments including GitHub Actions.
#
# USAGE:
#   ./scripts/generate-release-notes.sh <version>
#
# EXAMPLES:
#   ./scripts/generate-release-notes.sh 1.0.0-beta.11
#   ./scripts/generate-release-notes.sh 1.0.0
#
# OUTPUT:
#   Markdown formatted release notes suitable for GitHub releases
#
# =============================================================================

set -euo pipefail

VERSION="${1:-}"

if [ -z "$VERSION" ]; then
    echo "Usage: $0 <version>"
    echo "Example: $0 1.0.0-beta.11"
    exit 1
fi

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Find CHANGELOG.md
source "$SCRIPT_DIR/find-changelog.sh"

if [ -z "$CHANGELOG_PATH" ] || [ ! -f "$CHANGELOG_PATH" ]; then
    echo "Error: CHANGELOG.md not found"
    echo "Please ensure CHANGELOG.md exists in the project root"
    exit 1
fi

# Use changelog-to-html.sh and convert back to markdown
CHANGELOG_HTML=$("$SCRIPT_DIR/changelog-to-html.sh" "$VERSION" "$CHANGELOG_PATH" 2>/dev/null || echo "")

# Check if we got valid content
if [ -z "$CHANGELOG_HTML" ] || [[ "$CHANGELOG_HTML" == *"Latest version of VibeTunnel"* ]]; then
    # Try with .0 added for pre-releases (e.g., 1.0-beta.2 -> 1.0.0-beta.2)
    if [[ "$VERSION" =~ ^([0-9]+\.[0-9]+)(-.*)?$ ]]; then
        EXPANDED_VERSION="${BASH_REMATCH[1]}.0${BASH_REMATCH[2]}"
        CHANGELOG_HTML=$("$SCRIPT_DIR/changelog-to-html.sh" "$EXPANDED_VERSION" "$CHANGELOG_PATH" 2>/dev/null || echo "")
    fi
fi

# Convert HTML back to Markdown
if [ -n "$CHANGELOG_HTML" ] && [[ "$CHANGELOG_HTML" != *"Latest version of VibeTunnel"* ]]; then
    echo "$CHANGELOG_HTML" | \
        sed 's/<h3>/### /g' | \
        sed 's/<\/h3>//g' | \
        sed 's/<h2>/## /g' | \
        sed 's/<\/h2>//g' | \
        sed 's/<ul>/\n/g' | \
        sed 's/<\/ul>/\n/g' | \
        sed 's/<li>/- /g' | \
        sed 's/<\/li>//g' | \
        sed 's/<strong>/**/g' | \
        sed 's/<\/strong>/**/g' | \
        sed 's/<code>/`/g' | \
        sed 's/<\/code>/`/g' | \
        sed 's/<a href="\([^"]*\)">\([^<]*\)<\/a>/[\2](\1)/g' | \
        sed 's/<p>//g' | \
        sed 's/<\/p>/\n/g' | \
        sed 's/<div>//g' | \
        sed 's/<\/div>//g' | \
        sed '/^$/N;/^\n$/d'  # Remove multiple blank lines
else
    # Fallback: Generate basic release notes
    echo "## VibeTunnel $VERSION"
    echo ""
    echo "This release includes various improvements and bug fixes."
    echo ""
    echo "For details, please see the [CHANGELOG](https://github.com/amantus-ai/vibetunnel/blob/main/CHANGELOG.md)."
fi