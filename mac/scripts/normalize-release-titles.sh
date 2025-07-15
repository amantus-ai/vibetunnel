#!/bin/bash

# =============================================================================
# VibeTunnel Release Title Normalizer
# =============================================================================
#
# This script updates GitHub release titles to use a consistent format:
# From: "VibeTunnel 1.0.0-beta.10"
# To:   "VibeTunnel 1.0.0 Beta 10"
#
# USAGE:
#   ./scripts/normalize-release-titles.sh [--dry-run]
#
# OPTIONS:
#   --dry-run    Show what would be changed without actually updating
#
# =============================================================================

set -euo pipefail

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

# Function to normalize a release title
normalize_title() {
    local title="$1"
    local normalized="$title"
    
    # Pattern: VibeTunnel X.Y.Z-beta.N -> VibeTunnel X.Y.Z Beta N
    # Also handle: VibeTunnel X.Y-beta.N -> VibeTunnel X.Y.0 Beta N
    if [[ "$title" =~ ^(VibeTunnel[[:space:]]+)([0-9]+\.[0-9]+(\.[0-9]+)?)-beta\.([0-9]+)(.*)$ ]]; then
        local prefix="${BASH_REMATCH[1]}"
        local version="${BASH_REMATCH[2]}"
        local beta_num="${BASH_REMATCH[4]}"
        local suffix="${BASH_REMATCH[5]}"
        
        # Add .0 if version only has major.minor
        if [[ ! "$version" =~ \.[0-9]+$ ]]; then
            version="${version}.0"
        fi
        
        normalized="${prefix}${version} Beta ${beta_num}${suffix}"
    fi
    
    # Pattern: VibeTunnel X.Y.Z-alpha.N -> VibeTunnel X.Y.Z Alpha N
    if [[ "$title" =~ ^(VibeTunnel[[:space:]]+)([0-9]+\.[0-9]+(\.[0-9]+)?)-alpha\.([0-9]+)(.*)$ ]]; then
        local prefix="${BASH_REMATCH[1]}"
        local version="${BASH_REMATCH[2]}"
        local alpha_num="${BASH_REMATCH[4]}"
        local suffix="${BASH_REMATCH[5]}"
        
        # Add .0 if version only has major.minor
        if [[ ! "$version" =~ \.[0-9]+$ ]]; then
            version="${version}.0"
        fi
        
        normalized="${prefix}${version} Alpha ${alpha_num}${suffix}"
    fi
    
    # Pattern: VibeTunnel X.Y.Z-rc.N -> VibeTunnel X.Y.Z RC N
    if [[ "$title" =~ ^(VibeTunnel[[:space:]]+)([0-9]+\.[0-9]+(\.[0-9]+)?)-rc\.([0-9]+)(.*)$ ]]; then
        local prefix="${BASH_REMATCH[1]}"
        local version="${BASH_REMATCH[2]}"
        local rc_num="${BASH_REMATCH[4]}"
        local suffix="${BASH_REMATCH[5]}"
        
        # Add .0 if version only has major.minor
        if [[ ! "$version" =~ \.[0-9]+$ ]]; then
            version="${version}.0"
        fi
        
        normalized="${prefix}${version} RC ${rc_num}${suffix}"
    fi
    
    echo "$normalized"
}

# Get list of all releases
echo "🔍 Fetching releases..."
RELEASES=$(gh release list --limit 50 --json tagName,name | jq -r '.[] | [.tagName, .name] | @tsv')

if [[ -z "$RELEASES" ]]; then
    echo -e "${YELLOW}No releases found${NC}"
    exit 0
fi

# Track changes
changes_made=0

# Process each release
while IFS=$'\t' read -r tag current_title; do
    # Normalize the title
    new_title=$(normalize_title "$current_title")
    
    # Check if title needs updating
    if [[ "$current_title" != "$new_title" ]]; then
        echo -e "\n📦 Release: ${GREEN}$tag${NC}"
        echo -e "  Current: ${RED}$current_title${NC}"
        echo -e "  New:     ${GREEN}$new_title${NC}"
        
        if [[ "$DRY_RUN" == "false" ]]; then
            # Update the release title
            gh release edit "$tag" --title "$new_title"
            echo -e "  ${GREEN}✨ Updated successfully${NC}"
            ((changes_made++))
        else
            echo -e "  ${YELLOW}[DRY RUN] Would update this title${NC}"
        fi
    fi
done <<< "$RELEASES"

# Summary
echo -e "\n${GREEN}✅ Done!${NC}"

if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${YELLOW}This was a dry run. Run without --dry-run to make actual changes.${NC}"
else
    echo -e "Updated ${GREEN}$changes_made${NC} release titles."
fi