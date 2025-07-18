#!/bin/bash

# =============================================================================
# VibeTunnel Release Changelog Fixer
# =============================================================================
#
# This script updates existing GitHub releases to show only their own changelog
# instead of the cumulative changelog history.
#
# USAGE:
#   ./scripts/fix-release-changelogs.sh [--dry-run]
#
# OPTIONS:
#   --dry-run    Show what would be changed without actually updating
#
# =============================================================================

set -euo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check for dry-run mode
DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN=true
    echo -e "${YELLOW}DRY RUN MODE - No changes will be made${NC}"
fi

# Find changelog file - try multiple locations
CHANGELOG_PATH=""
if [[ -f "$PROJECT_ROOT/../CHANGELOG.md" ]]; then
    CHANGELOG_PATH="$PROJECT_ROOT/../CHANGELOG.md"
elif [[ -f "$PROJECT_ROOT/CHANGELOG.md" ]]; then
    CHANGELOG_PATH="$PROJECT_ROOT/CHANGELOG.md"
elif [[ -f "$SCRIPT_DIR/../../CHANGELOG.md" ]]; then
    CHANGELOG_PATH="$SCRIPT_DIR/../../CHANGELOG.md"
elif [[ -f "CHANGELOG.md" ]]; then
    CHANGELOG_PATH="$(pwd)/CHANGELOG.md"
else
    echo -e "${RED}❌ Error: CHANGELOG.md not found${NC}"
    echo "Searched in:"
    echo "  - $PROJECT_ROOT/../CHANGELOG.md"
    echo "  - $PROJECT_ROOT/CHANGELOG.md"
    echo "  - $SCRIPT_DIR/../../CHANGELOG.md"
    echo "  - $(pwd)/CHANGELOG.md"
    exit 1
fi

echo "📋 Using changelog: $CHANGELOG_PATH"

# Function to extract and format changelog for a specific version
generate_release_notes() {
    local version="$1"
    local changelog_html=""
    
    # Use the existing changelog-to-html.sh script
    if [[ -x "$SCRIPT_DIR/changelog-to-html.sh" ]]; then
        changelog_html=$("$SCRIPT_DIR/changelog-to-html.sh" "$version" "$CHANGELOG_PATH" 2>/dev/null || echo "")
    fi
    
    # If we got HTML content, format it nicely for GitHub
    if [[ -n "$changelog_html" ]] && [[ "$changelog_html" != *"Latest version of VibeTunnel"* ]]; then
        # Convert HTML back to Markdown for GitHub (basic conversion)
        echo "$changelog_html" | \
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
        # Fallback: Try to extract directly from markdown
        awk -v version="$version" '
        BEGIN { found=0; print_section=0 }
        /^## \[/ && $0 ~ "\\[" version "\\]" { found=1; print_section=1; next }
        found && print_section && /^## / { print_section=0 }
        found && print_section { print }
        ' "$CHANGELOG_PATH"
    fi
}

# Get list of releases
echo "🔍 Fetching releases..."
RELEASES=$(gh release list --limit 20 --json tagName,name,isPrerelease | jq -r '.[] | select(.isPrerelease == true) | .tagName')

if [[ -z "$RELEASES" ]]; then
    echo -e "${YELLOW}No pre-releases found to update${NC}"
    exit 0
fi

# Process each release
for tag in $RELEASES; do
    # Extract version from tag (remove 'v' prefix)
    version="${tag#v}"
    
    echo -e "\n📦 Processing release: ${GREEN}$tag${NC} (version: $version)"
    
    # Get current release body
    current_body=$(gh release view "$tag" --json body | jq -r '.body')
    current_lines=$(echo "$current_body" | wc -l)
    
    # Generate new release notes for this version only
    new_body=$(generate_release_notes "$version")
    new_lines=$(echo "$new_body" | wc -l)
    
    if [[ -z "$new_body" ]]; then
        echo -e "  ${YELLOW}⚠️  No changelog found for version $version${NC}"
        continue
    fi
    
    # Check if update is needed (simple heuristic: if current has way more lines than new)
    if [[ $current_lines -gt 100 ]] && [[ $new_lines -lt 100 ]]; then
        echo -e "  ${YELLOW}📏 Current: $current_lines lines, New: $new_lines lines${NC}"
        echo -e "  ${GREEN}✅ Update needed${NC}"
        
        if [[ "$DRY_RUN" == "false" ]]; then
            # Create temp file with new body
            temp_file=$(mktemp)
            echo "$new_body" > "$temp_file"
            
            # Update the release
            gh release edit "$tag" --notes-file "$temp_file"
            rm "$temp_file"
            
            echo -e "  ${GREEN}✨ Updated successfully${NC}"
        else
            echo -e "  ${YELLOW}[DRY RUN] Would update this release${NC}"
            echo "  First 10 lines of new content:"
            echo "$new_body" | head -10 | sed 's/^/    /'
        fi
    else
        echo -e "  ${GREEN}✓ Already using per-release changelog (or too similar in size)${NC}"
    fi
done

echo -e "\n${GREEN}✅ Done!${NC}"

if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${YELLOW}This was a dry run. Run without --dry-run to make actual changes.${NC}"
fi