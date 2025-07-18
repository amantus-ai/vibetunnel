#!/bin/bash

# Script to validate that all documentation files referenced in docs.json exist

set -e

# Change to the repository root
cd "$(dirname "$0")/.."

echo "Validating documentation references in docs.json..."

# Extract all page references from docs.json
missing_files=0

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed. Install it with: brew install jq"
    exit 1
fi

# Extract all pages from the navigation structure
pages=$(jq -r '.. | objects | select(has("pages")) | .pages[]?' docs.json 2>/dev/null || true)

if [ -z "$pages" ]; then
    echo "No pages found in docs.json"
    exit 0
fi

echo "Checking documentation files..."
echo

while IFS= read -r doc; do
    # Skip empty lines
    [ -z "$doc" ] && continue
    
    # Check for .md file
    if [ -f "$doc.md" ]; then
        echo "✓ Found: $doc.md"
    # Check for .mdx file
    elif [ -f "$doc.mdx" ]; then
        echo "✓ Found: $doc.mdx"
    # Check if it's already a full path with extension
    elif [ -f "$doc" ]; then
        echo "✓ Found: $doc"
    # Special case for paths starting with .
    elif [[ "$doc" == ./* ]] && [ -f "$doc" ]; then
        echo "✓ Found: $doc"
    else
        echo "✗ Missing: $doc"
        missing_files=$((missing_files + 1))
    fi
done <<< "$pages"

echo
echo "Summary:"
echo "--------"
total_refs=$(echo "$pages" | wc -l | tr -d ' ')
found_refs=$((total_refs - missing_files))
echo "Total references: $total_refs"
echo "Found: $found_refs"
echo "Missing: $missing_files"

if [ $missing_files -gt 0 ]; then
    echo
    echo "Error: Found $missing_files missing documentation files!"
    exit 1
else
    echo
    echo "Success: All documentation files exist!"
    exit 0
fi