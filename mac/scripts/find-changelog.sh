#!/bin/bash

# =============================================================================
# VibeTunnel Changelog Finder
# =============================================================================
#
# Finds the CHANGELOG.md file from various possible locations.
# This script ensures consistent changelog discovery across different
# execution contexts (local development, CI, GitHub Actions, etc.)
#
# USAGE:
#   source ./scripts/find-changelog.sh
#   # Now $CHANGELOG_PATH contains the path to CHANGELOG.md
#
# =============================================================================

# Function to find changelog file
find_changelog() {
    local script_dir="$1"
    local search_paths=(
        # From mac/scripts directory
        "$script_dir/../../CHANGELOG.md"
        # From mac directory
        "$script_dir/../CHANGELOG.md"
        # From project root
        "CHANGELOG.md"
        # From parent directory
        "../CHANGELOG.md"
        # From grandparent directory
        "../../CHANGELOG.md"
        # Absolute paths as fallback
        "$HOME/Projects/vibetunnel/CHANGELOG.md"
        "/Users/runner/work/vibetunnel/vibetunnel/CHANGELOG.md"  # GitHub Actions
    )
    
    for path in "${search_paths[@]}"; do
        if [ -f "$path" ]; then
            # Return the absolute path
            echo "$(cd "$(dirname "$path")" && pwd)/$(basename "$path")"
            return 0
        fi
    done
    
    return 1
}

# If sourced, set CHANGELOG_PATH
if [ "${BASH_SOURCE[0]}" != "${0}" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    CHANGELOG_PATH=$(find_changelog "$SCRIPT_DIR")
    if [ -z "$CHANGELOG_PATH" ]; then
        echo "Warning: CHANGELOG.md not found" >&2
    fi
else
    # If executed directly, print the path
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    CHANGELOG_PATH=$(find_changelog "$SCRIPT_DIR")
    if [ -n "$CHANGELOG_PATH" ]; then
        echo "$CHANGELOG_PATH"
    else
        echo "Error: CHANGELOG.md not found" >&2
        exit 1
    fi
fi