#!/bin/bash
#
# Install Bun locally for the build process if not already available
#
# This script ensures Bun is available for building VibeTunnel without
# requiring any pre-installed tools except Xcode.
#

set -uo pipefail  # Remove 'e' flag to allow non-critical failures

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Script directory and paths
# Handle both bash and zsh
if [ -n "${BASH_SOURCE[0]:-}" ]; then
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
else
    SCRIPT_DIR="$( cd "$( dirname "$0" )" && pwd )"
fi
PROJECT_DIR="$SCRIPT_DIR/.."
BUILD_TOOLS_DIR="$PROJECT_DIR/.build-tools"
BUN_DIR="$BUILD_TOOLS_DIR/bun"
BUN_BINARY="$BUN_DIR/bin/bun"

# Pinned release assets verified against provider-published checksums.
BUN_VERSION="1.3.14"

echo -e "${GREEN}Checking for Bun...${NC}"

# Function to install Bun
install_bun() {
    echo -e "${YELLOW}Bun not found. Installing Bun locally...${NC}"
    
    # Create build tools directory
    mkdir -p "$BUILD_TOOLS_DIR"
    
    # Download and install Bun to local directory
    echo "Downloading Bun..."
    if ! command -v curl &> /dev/null; then
        echo -e "${RED}Error: curl is required to download Bun${NC}"
        echo "curl should be available on macOS by default"
        exit 1
    fi

    if ! command -v unzip &> /dev/null; then
        echo -e "${RED}Error: unzip is required to install Bun${NC}"
        exit 1
    fi

    local arch bun_asset bun_sha tmp_dir bun_archive extracted_bun
    arch="$(uname -m)"
    case "$arch" in
        arm64|aarch64)
            bun_asset="bun-darwin-aarch64.zip"
            bun_sha="d8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620"
            ;;
        x86_64|amd64)
            bun_asset="bun-darwin-x64.zip"
            bun_sha="4183df3374623e5bab315c547cfa0974533cd457d86b73b639f7a87974cd6633"
            ;;
        *)
            echo -e "${RED}Error: Unsupported architecture: $arch${NC}"
            exit 1
            ;;
    esac

    tmp_dir="$(mktemp -d)"
    bun_archive="$tmp_dir/$bun_asset"
    if ! curl -fsSL \
        "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${bun_asset}" \
        -o "$bun_archive"; then
        rm -rf "$tmp_dir"
        exit 1
    fi

    if ! echo "${bun_sha}  ${bun_archive}" | shasum -a 256 -c - >/dev/null 2>&1; then
        echo -e "${RED}Error: Bun checksum verification failed${NC}"
        rm -rf "$tmp_dir"
        exit 1
    fi

    if ! unzip -q "$bun_archive" -d "$tmp_dir"; then
        rm -rf "$tmp_dir"
        exit 1
    fi
    extracted_bun="$tmp_dir/${bun_asset%.zip}/bun"
    if [ ! -f "$extracted_bun" ]; then
        echo -e "${RED}Error: Extracted Bun binary not found${NC}"
        rm -rf "$tmp_dir"
        exit 1
    fi

    mkdir -p "$BUN_DIR/bin"
    cp "$extracted_bun" "$BUN_BINARY"
    chmod +x "$BUN_BINARY"
    rm -rf "$tmp_dir"
    
    # Verify installation
    if [ -f "$BUN_BINARY" ]; then
        echo -e "${GREEN}✓ Bun installed successfully${NC}"
        "$BUN_BINARY" --version
    else
        echo -e "${RED}Error: Bun installation failed${NC}"
        exit 1
    fi
}

# Check if Bun is already in PATH
if command -v bun &> /dev/null; then
    echo -e "${GREEN}✓ Bun found in PATH: $(which bun)${NC}"
    echo "  Version: $(bun --version)"
    exit 0
fi

# Check if we have a local Bun installation
if [ -f "$BUN_BINARY" ]; then
    echo -e "${GREEN}✓ Bun found locally: $BUN_BINARY${NC}"
    echo "  Version: $("$BUN_BINARY" --version)"
    
    # Export path for use in other scripts
    echo "export PATH=\"$BUN_DIR/bin:\$PATH\""
    exit 0
fi

# No Bun found, check alternatives
echo -e "${YELLOW}Bun not found in PATH or locally${NC}"

# Check if npx is available as an alternative
if command -v npx &> /dev/null; then
    echo -e "${GREEN}✓ npx found - can use 'npx bun' as fallback${NC}"
    echo "  npx version: $(npx --version)"
    exit 0
fi

# Check if prebuilts are available
PREBUILTS_DIR="$PROJECT_DIR/Resources/BunPrebuilts"
if [ -d "$PREBUILTS_DIR/arm64" ] && [ -f "$PREBUILTS_DIR/arm64/vibetunnel" ]; then
    echo -e "${YELLOW}No npx found, but prebuilt binaries are available${NC}"
    echo -e "${GREEN}✓ Build can proceed using prebuilt binaries${NC}"
    exit 0
fi

# No alternatives found, try to install Bun
echo -e "${YELLOW}No alternatives found. Attempting to install Bun locally...${NC}"
install_bun || {
    echo -e "${YELLOW}Warning: Bun installation failed${NC}"
    echo -e "${YELLOW}Build may fail without bun, npx, or prebuilt binaries${NC}"
    exit 0
}

# Export path for use in other scripts
echo "export PATH=\"$BUN_DIR/bin:\$PATH\""
