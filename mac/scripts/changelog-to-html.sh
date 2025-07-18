#!/bin/bash

# =============================================================================
# VibeTunnel Changelog to HTML Converter
# =============================================================================
#
# Converts specific version sections from CHANGELOG.md to HTML format for
# inclusion in Sparkle appcast descriptions. Supports markdown formatting
# including headers, lists, bold text, code, and links.
#
# USAGE:
#   ./scripts/changelog-to-html.sh <version> [changelog_file]
#
# ARGUMENTS:
#   version         Version to extract (e.g., "0.1")
#   changelog_file  Path to changelog file (default: CHANGELOG.md)
#
# OUTPUT:
#   HTML formatted changelog section suitable for Sparkle appcast
#
# EXAMPLES:
#   ./scripts/changelog-to-html.sh 0.1
#   ./scripts/changelog-to-html.sh 0.1 docs/CHANGELOG.md
#
# =============================================================================

set -euo pipefail

VERSION="${1:-}"
CHANGELOG_FILE="${2:-}"

if [ -z "$VERSION" ]; then
    echo "Usage: $0 <version> [changelog_file]"
    echo "Example: $0 0.1 CHANGELOG.md"
    exit 1
fi

# If no changelog file specified, try to find it
if [ -z "$CHANGELOG_FILE" ]; then
    # Get script directory
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    
    # Try multiple locations in order of preference
    if [ -f "$SCRIPT_DIR/../../CHANGELOG.md" ]; then
        CHANGELOG_FILE="$SCRIPT_DIR/../../CHANGELOG.md"
    elif [ -f "$SCRIPT_DIR/../CHANGELOG.md" ]; then
        CHANGELOG_FILE="$SCRIPT_DIR/../CHANGELOG.md"
    elif [ -f "CHANGELOG.md" ]; then
        CHANGELOG_FILE="CHANGELOG.md"
    elif [ -f "../CHANGELOG.md" ]; then
        CHANGELOG_FILE="../CHANGELOG.md"
    elif [ -f "../../CHANGELOG.md" ]; then
        CHANGELOG_FILE="../../CHANGELOG.md"
    else
        echo "Error: Could not find CHANGELOG.md in any expected location"
        echo "Searched in:"
        echo "  - $SCRIPT_DIR/../../CHANGELOG.md (project root from mac/scripts)"
        echo "  - $SCRIPT_DIR/../CHANGELOG.md (mac directory)"
        echo "  - ./CHANGELOG.md (current directory)"
        echo "  - ../CHANGELOG.md (parent directory)"
        echo "  - ../../CHANGELOG.md (grandparent directory)"
        exit 1
    fi
fi

if [ ! -f "$CHANGELOG_FILE" ]; then
    echo "Error: Changelog file '$CHANGELOG_FILE' not found"
    exit 1
fi

# Function to convert markdown to basic HTML
markdown_to_html() {
    local text="$1"
    
    # Convert headers
    text=$(echo "$text" | sed 's/^### \(.*\)$/<h3>\1<\/h3>/')
    text=$(echo "$text" | sed 's/^## \(.*\)$/<h2>\1<\/h2>/')
    
    # Convert bullet points with emoji support
    text=$(echo "$text" | sed 's/^- \*\*\([^*]*\)\*\*\(.*\)$/<li><strong>\1<\/strong>\2<\/li>/')
    text=$(echo "$text" | sed 's/^- \([^*].*\)$/<li>\1<\/li>/')
    
    # Convert bold text
    text=$(echo "$text" | sed 's/\*\*\([^*]*\)\*\*/\<strong\>\1\<\/strong\>/g')
    
    # Convert inline code
    text=$(echo "$text" | sed 's/`\([^`]*\)`/<code>\1<\/code>/g')
    
    # Convert links [text](url) to <a href="url">text</a>
    text=$(echo "$text" | sed 's/\[\([^]]*\)\](\([^)]*\))/<a href="\2">\1<\/a>/g')
    
    echo "$text"
}

# Extract version section from changelog
extract_version_section() {
    local version="$1"
    local file="$2"
    
    # Look for version header (supports [0.1] or ## 0.1 formats)
    # Extract from version header to next version header or end of file
    awk -v version="$version" '
    BEGIN { found=0; print_section=0 }
    /^## \[/ && $0 ~ "\\[" version "\\]" { found=1; print_section=1; next }
    found && print_section && /^## / { print_section=0 }
    found && print_section { print }
    ' "$file"
}

# Main processing
# Note: Debug output redirected to stderr to avoid polluting HTML output
echo "Extracting changelog for version $VERSION..." >&2

# Extract the version section
version_content=$(extract_version_section "$VERSION" "$CHANGELOG_FILE")

if [ -z "$version_content" ]; then
    echo "Warning: No changelog section found for version $VERSION" >&2
    echo "Using default content..." >&2
    cat << EOF
<h2>VibeTunnel $VERSION</h2>
<p>Latest version of VibeTunnel with new features and improvements.</p>
<p><a href="https://github.com/amantus-ai/vibetunnel/blob/main/CHANGELOG.md">View full changelog</a></p>
EOF
    exit 0
fi

# Convert to HTML
# Note: Title is handled by the calling script (e.g., generate-appcast.sh)

# Process line by line to handle lists properly
in_list=false
while IFS= read -r line; do
    if [[ "$line" =~ ^- ]]; then
        if [ "$in_list" = false ]; then
            echo "<ul>"
            in_list=true
        fi
        markdown_to_html "$line"
    else
        if [ "$in_list" = true ]; then
            echo "</ul>"
            in_list=false
        fi
        
        # Skip empty lines and date headers
        if [ -n "$line" ] && [[ ! "$line" =~ ^\[.*\].*[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
            markdown_to_html "$line"
        fi
    fi
done <<< "$version_content"

# Close list if still open
if [ "$in_list" = true ]; then
    echo "</ul>"
fi

# Add link to full changelog
echo "<p><a href=\"https://github.com/amantus-ai/vibetunnel/blob/main/CHANGELOG.md#${VERSION//./}-$(date +%Y%m%d)\">View full changelog</a></p>"