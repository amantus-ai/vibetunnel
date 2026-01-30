#!/bin/bash

# =============================================================================
# VibeTunnel Xcode Project Generation Script
# =============================================================================
#
# This script generates the Xcode project and workspace using Tuist, with
# automatic patches applied for Swift 6 Sendable compliance. It's essential
# to run this script after any changes to Project.swift or Tuist.swift.
#
# USAGE:
#   ./scripts/generate-xcproj.sh
#
# FEATURES:
#   - Runs Tuist project generation silently (no Xcode restart)
#   - Applies Swift 6 Sendable compliance patches
#   - Allows regeneration while Xcode is open
#
# DEPENDENCIES:
#   - Tuist (project generation tool)
#   - Xcode (for opening the workspace)
#
# FILES GENERATED:
#   - VibeTunnel.xcodeproj/ (Xcode project)
#   - VibeTunnel.xcworkspace/ (Xcode workspace)
#   - Derived/ (generated sources and Info.plist files)
#
# EXAMPLES:
#   ./scripts/generate-xcproj.sh
#
# NOTES:
#   - Always run this after modifying Project.swift or Tuist.swift
#   - The script includes patches for Swift 6 compliance
#   - Generated files are partially tracked in git for CI compatibility
#
# =============================================================================

set -e

# Change to the project directory
cd "$(dirname "$0")/.."

# Skip Xcode quit/restart to allow silent regeneration while Xcode is open

echo "Generating Xcode project with Tuist..."
tuist generate --no-open

echo "Patching generated files for Swift 6 Sendable compliance..."

# Function to patch Info.plist accessor files
patch_info_plist_accessors() {
    local file=$1
    
    if [ -f "$file" ]; then
        echo "Patching $file..."
        
        # Replace [String: Any] with [String: Bool] for NSAppTransportSecurity
        sed -i '' 's/\[String: Any\]/[String: Bool]/g' "$file"
        
        # Replace [[String: Any]] with [[String: Sendable]] for arrays
        sed -i '' 's/\[\[String: Any\]\]/[[String: Sendable]]/g' "$file"
        
        # Update the ResourceLoader struct to handle typed dictionaries
        # Replace dictionary<String, Any> with dictionary<String, Bool>
        sed -i '' 's/dictionary<String, Any>/dictionary<String, Bool>/g' "$file"
        
        # Replace arrayOfDictionaries<String, Any> with arrayOfDictionaries<String, Sendable>
        sed -i '' 's/arrayOfDictionaries<String, Any>/arrayOfDictionaries<String, Sendable>/g' "$file"
    fi
}

# Find and patch all Info.plist accessor files
find . -path "*/Derived/InfoPlists+*" -name "*.swift" | while read -r file; do
    patch_info_plist_accessors "$file"
done

# Skip opening workspace to allow silent regeneration

echo "✅ Xcode project generated and patched successfully!"