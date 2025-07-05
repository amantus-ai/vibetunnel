#!/bin/bash

# Fix VibeTunnel icon padding to match macOS standards
# This script adds 12% padding to all icon sizes

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ICON_DIR="$SCRIPT_DIR/../VibeTunnel/Assets.xcassets/AppIcon.appiconset"

# Check if ImageMagick is installed
if ! command -v convert &> /dev/null; then
    echo "ImageMagick is required but not installed."
    echo "Install with: brew install imagemagick"
    exit 1
fi

echo "Adding padding to VibeTunnel app icons..."

# Create backup directory
BACKUP_DIR="$ICON_DIR/backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Function to add padding to an icon
add_padding() {
    local input_file="$1"
    local filename=$(basename "$input_file")
    
    # Skip if file doesn't exist
    if [ ! -f "$input_file" ]; then
        return
    fi
    
    # Get dimensions
    local dimensions=$(identify -format "%wx%h" "$input_file")
    local width=$(echo $dimensions | cut -d'x' -f1)
    local height=$(echo $dimensions | cut -d'x' -f2)
    
    # Calculate new size with 88% of original (12% padding on each side = 76% total size)
    local new_size=$(echo "$width * 0.76" | bc | cut -d'.' -f1)
    
    echo "Processing $filename ($dimensions -> ${new_size}x${new_size} with padding)..."
    
    # Backup original
    cp "$input_file" "$BACKUP_DIR/$filename"
    
    # Add padding by resizing the content and re-expanding to original size
    convert "$input_file" \
        -resize "${new_size}x${new_size}" \
        -gravity center \
        -background transparent \
        -extent "${width}x${height}" \
        "$input_file"
}

# Process all PNG files in the icon set
cd "$ICON_DIR"
for icon in *.png; do
    add_padding "$icon"
done

echo ""
echo "✅ Icon padding fixed!"
echo "📁 Original icons backed up to: $BACKUP_DIR"
echo ""
echo "Next steps:"
echo "1. Rebuild the app in Xcode"
echo "2. The updated icon should now match other dock icons"
echo ""
echo "If you need to restore the original icons:"
echo "cp $BACKUP_DIR/*.png $ICON_DIR/"