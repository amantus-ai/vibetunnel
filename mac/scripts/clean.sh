#!/bin/bash

# =============================================================================
# VibeTunnel Build Cleanup Script
# =============================================================================
#
# This script cleans up build artifacts and temporary files to free up disk space.
#
# USAGE:
#   ./scripts/clean.sh [options]
#
# OPTIONS:
#   --all         Clean everything including release DMGs
#   --keep-dmg    Keep release DMG files (default)
#   --dry-run     Show what would be deleted without actually deleting
#
# FEATURES:
#   - Removes build directories and DerivedData
#   - Cleans temporary files and caches
#   - Preserves release DMGs by default
#   - Shows disk space freed
#
# =============================================================================

set -euo pipefail

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$SCRIPT_DIR/common.sh" ]] && source "$SCRIPT_DIR/common.sh" || true

PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Parse arguments
CLEAN_ALL=false
KEEP_DMG=true
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --all)
            CLEAN_ALL=true
            KEEP_DMG=false
            shift
            ;;
        --keep-dmg)
            KEEP_DMG=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--all] [--keep-dmg] [--dry-run]"
            exit 1
            ;;
    esac
done

# Function to get directory size
get_size() {
    local path="$1"
    if [[ -d "$path" ]]; then
        du -sh "$path" 2>/dev/null | awk '{print $1}'
    else
        echo "0"
    fi
}

# Function to remove with dry-run support
remove_item() {
    local item="$1"
    local description="${2:-$item}"
    
    if [[ -e "$item" ]]; then
        local size=$(get_size "$item")
        if [[ "$DRY_RUN" == "true" ]]; then
            print_info "[DRY RUN] Would remove $description ($size)"
        else
            print_info "Removing $description ($size)..."
            rm -rf "$item"
            print_success "Removed $description"
        fi
    fi
}

cd "$PROJECT_ROOT"

print_info "Starting cleanup..."
[[ "$DRY_RUN" == "true" ]] && print_warning "DRY RUN MODE - Nothing will be deleted"

# Get initial disk usage
INITIAL_SIZE=$(du -sh . 2>/dev/null | awk '{print $1}')

# Clean build directories
remove_item "build/Build" "Xcode build artifacts"
remove_item "build/ModuleCache" "Module cache"
remove_item "build/SourcePackages" "Source packages"
remove_item "build/dmg-temp" "DMG temporary files"
remove_item "DerivedData" "DerivedData"

# Clean Go build artifacts
if [[ "$CLEAN_ALL" == "true" ]]; then
    remove_item "linux/build" "Go build artifacts"
else
    # Keep the release binaries but clean intermediate files
    find linux/build -type f -name "*.a" -delete 2>/dev/null || true
    find linux/build -type f -name "*.o" -delete 2>/dev/null || true
    [[ "$DRY_RUN" == "false" ]] && print_success "Cleaned Go intermediate files"
fi

# Clean SPM build artifacts
remove_item ".build" "Swift Package Manager build"

# Clean user-specific Xcode DerivedData
XCODE_DERIVED_DATA="$HOME/Library/Developer/Xcode/DerivedData"
if [[ -d "$XCODE_DERIVED_DATA" ]]; then
    for dir in "$XCODE_DERIVED_DATA"/VibeTunnel-*; do
        if [[ -d "$dir" ]]; then
            remove_item "$dir" "Xcode DerivedData for VibeTunnel"
        fi
    done
fi

# Clean temporary files
find . -name ".DS_Store" -delete 2>/dev/null || true
find . -name "*.swp" -delete 2>/dev/null || true
find . -name "*~" -delete 2>/dev/null || true
find . -name "*.tmp" -delete 2>/dev/null || true
[[ "$DRY_RUN" == "false" ]] && print_success "Cleaned temporary files"

# Clean old DMGs (keep latest)
if [[ "$KEEP_DMG" == "false" ]]; then
    remove_item "build/*.dmg" "All DMG files"
else
    # Keep only the latest DMG
    DMG_COUNT=$(ls -1 build/*.dmg 2>/dev/null | wc -l | tr -d ' ')
    if [[ $DMG_COUNT -gt 1 ]]; then
        print_info "Keeping latest DMG, removing older ones..."
        ls -t build/*.dmg | tail -n +2 | while read dmg; do
            remove_item "$dmg" "Old DMG: $(basename "$dmg")"
        done
    fi
fi

# Clean node_modules if requested
if [[ "$CLEAN_ALL" == "true" ]]; then
    remove_item "web/node_modules" "Node.js dependencies"
    remove_item "web/.next" "Next.js build cache"
fi

# Clean web build artifacts (always clean these)
if [[ -d "$PROJECT_ROOT/../web" ]]; then
    remove_item "$PROJECT_ROOT/../web/native" "Web native executables"
    remove_item "$PROJECT_ROOT/../web/dist" "Web dist directory"
    remove_item "$PROJECT_ROOT/../web/public/bundle" "Web bundle directory"
    remove_item "$PROJECT_ROOT/../web/public/output.css" "Web CSS output"
    remove_item "$PROJECT_ROOT/../web/build" "Web build directory"
    remove_item "$PROJECT_ROOT/../web/.node-builds" "Custom Node.js builds"
fi

# Clean Python caches
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find . -type f -name "*.pyc" -delete 2>/dev/null || true
[[ "$DRY_RUN" == "false" ]] && print_success "Cleaned Python caches"

# Get final disk usage
FINAL_SIZE=$(du -sh . 2>/dev/null | awk '{print $1}')

print_success "Cleanup complete!"
print_info "Disk usage: $INITIAL_SIZE → $FINAL_SIZE"

# Suggest additional cleanups if not using --all
if [[ "$CLEAN_ALL" == "false" ]]; then
    echo ""
    print_info "For more aggressive cleanup, use: $0 --all"
    print_info "This will also remove:"
    print_info "  - Release DMG files"
    print_info "  - Node.js dependencies"
    print_info "  - Rust target directory"
fi