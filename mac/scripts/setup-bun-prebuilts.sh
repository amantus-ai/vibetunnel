#!/bin/bash
#
# Setup pre-built binaries for universal app support
#
# This script copies the current architecture's binaries to the prebuilts directory
# and can also download pre-built binaries for other architectures if needed.
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
PROJECT_ROOT="$SCRIPT_DIR/../.."
MAC_DIR="$SCRIPT_DIR/.."
WEB_DIR="$PROJECT_ROOT/web"
PREBUILTS_DIR="$MAC_DIR/Resources/BunPrebuilts"

# VibeTunnel only supports ARM64
CURRENT_ARCH=$(uname -m)
if [ "$CURRENT_ARCH" != "arm64" ]; then
    echo -e "${RED}Error: VibeTunnel requires Apple Silicon (ARM64)${NC}"
    exit 1
fi
ARCH_DIR="arm64"

echo -e "${BLUE}Setting up prebuilt binaries...${NC}"
echo "Current architecture: $CURRENT_ARCH"

# Function to build and copy binaries for current architecture
build_current_arch() {
    echo -e "${YELLOW}Building binaries for $CURRENT_ARCH...${NC}"
    
    cd "$WEB_DIR"
    
    # Build if native directory doesn't exist
    if [ ! -f "native/vibetunnel" ]; then
        echo "Building executable..."
        if command -v node &> /dev/null; then
            node build-native.js
        else
            echo -e "${RED}Error: Node.js not found.${NC}"
            echo -e "${RED}Please install Node.js 20+ to build the executable.${NC}"
            exit 1
        fi
    fi
    
    # Create architecture directory
    mkdir -p "$PREBUILTS_DIR/$ARCH_DIR"
    
    # Copy binaries
    echo "Copying binaries to prebuilts directory..."
    cp -f native/vibetunnel "$PREBUILTS_DIR/$ARCH_DIR/"
    cp -f native/pty.node "$PREBUILTS_DIR/$ARCH_DIR/"
    cp -f native/spawn-helper "$PREBUILTS_DIR/$ARCH_DIR/"
    
    # Make executables executable
    chmod +x "$PREBUILTS_DIR/$ARCH_DIR/vibetunnel"
    chmod +x "$PREBUILTS_DIR/$ARCH_DIR/spawn-helper"
    
    echo -e "${GREEN}✓ Copied $CURRENT_ARCH binaries to prebuilts${NC}"
}

# Function to check prebuilt status
check_status() {
    echo -e "\n${BLUE}Prebuilt binaries status:${NC}"
    
    for arch in arm64; do
        echo -n "  $arch: "
        if [ -f "$PREBUILTS_DIR/$arch/vibetunnel" ] && \
           [ -f "$PREBUILTS_DIR/$arch/pty.node" ] && \
           [ -f "$PREBUILTS_DIR/$arch/spawn-helper" ]; then
            echo -e "${GREEN}✓ Complete${NC}"
            ls -lh "$PREBUILTS_DIR/$arch/" | grep -E "vibetunnel|pty.node|spawn-helper"
        else
            echo -e "${YELLOW}⚠ Missing${NC}"
            if [ -d "$PREBUILTS_DIR/$arch" ]; then
                echo "    Found:"
                ls -la "$PREBUILTS_DIR/$arch/" 2>/dev/null || echo "    (empty)"
            fi
        fi
    done
}

# Main logic
case "${1:-build}" in
    build)
        build_current_arch
        check_status
        ;;
    status)
        check_status
        ;;
    clean)
        echo -e "${YELLOW}Cleaning prebuilt binaries...${NC}"
        rm -rf "$PREBUILTS_DIR"/arm64
        mkdir -p "$PREBUILTS_DIR"/arm64
        echo -e "${GREEN}✓ Cleaned${NC}"
        ;;
    *)
        echo "Usage: $0 [build|status|clean]"
        echo "  build  - Build and copy binaries for current architecture (default)"
        echo "  status - Check status of prebuilt binaries"
        echo "  clean  - Remove all prebuilt binaries"
        exit 1
        ;;
esac

echo -e "\n${BLUE}Note:${NC} VibeTunnel requires Apple Silicon (M1/M2/M3) Macs."