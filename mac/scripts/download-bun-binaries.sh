#!/bin/bash
#
# Download pre-built Bun binaries for ARM64
# VibeTunnel only supports Apple Silicon Macs
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
MAC_DIR="$SCRIPT_DIR/.."
PREBUILTS_DIR="$MAC_DIR/Resources/BunPrebuilts"

# Bun version - update this as needed
BUN_VERSION="1.1.18"

echo -e "${BLUE}Downloading Bun binaries for ARM64...${NC}"
echo "Bun version: $BUN_VERSION"

# Create directory
mkdir -p "$PREBUILTS_DIR"/arm64

# Function to download and extract Bun
download_bun() {
    local arch=$1
    local bun_arch=$2
    local dest_dir="$PREBUILTS_DIR/$arch"
    
    echo -e "\n${YELLOW}Downloading Bun for $arch...${NC}"
    
    # Download URL
    local url="https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-darwin-${bun_arch}.zip"
    local temp_zip=$(mktemp)
    local temp_dir=$(mktemp -d)
    
    # Download
    echo "Downloading from: $url"
    if ! curl -L -o "$temp_zip" "$url"; then
        echo -e "${RED}Failed to download Bun for $arch${NC}"
        rm -f "$temp_zip"
        rm -rf "$temp_dir"
        return 1
    fi
    
    # Extract
    echo "Extracting..."
    unzip -q "$temp_zip" -d "$temp_dir"
    
    # Find the bun binary
    local bun_binary=$(find "$temp_dir" -name "bun" -type f | head -1)
    if [ -z "$bun_binary" ]; then
        echo -e "${RED}Could not find Bun binary in download${NC}"
        rm -f "$temp_zip"
        rm -rf "$temp_dir"
        return 1
    fi
    
    # Copy to destination as vibetunnel
    cp "$bun_binary" "$dest_dir/vibetunnel"
    chmod +x "$dest_dir/vibetunnel"
    
    # Clean up
    rm -f "$temp_zip"
    rm -rf "$temp_dir"
    
    echo -e "${GREEN}✓ Downloaded Bun for $arch${NC}"
    return 0
}

# Download ARM64 only
download_bun "arm64" "aarch64" || echo -e "${YELLOW}Warning: Failed to download arm64 Bun${NC}"

echo -e "\n${BLUE}Note: You still need the native modules (pty.node).${NC}"
echo "These must be built on Apple Silicon."
echo ""
echo "Current status:"
ls -lh "$PREBUILTS_DIR"/arm64/vibetunnel 2>/dev/null && echo "  ✓ arm64 Bun binary downloaded" || echo "  ✗ arm64 Bun binary missing"