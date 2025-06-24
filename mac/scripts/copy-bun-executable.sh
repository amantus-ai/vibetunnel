#!/bin/bash
#
# Copy executable and native modules to the app bundle
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/../.."
WEB_DIR="$PROJECT_ROOT/web"
NATIVE_DIR="$WEB_DIR/native"

# Destination (passed as argument or use default)
if [ $# -eq 0 ]; then
    echo -e "${RED}Error: No destination path provided${NC}"
    echo "Usage: $0 <destination_resources_path>"
    exit 1
fi

DEST_RESOURCES="$1"

echo -e "${GREEN}Copying executable and native modules...${NC}"

# Check if native directory exists
if [ ! -d "$NATIVE_DIR" ]; then
    echo -e "${YELLOW}Warning: Native directory not found at $NATIVE_DIR${NC}"
    echo -e "${YELLOW}Run 'pnpm run build:native' in the web directory first${NC}"
    exit 0
fi

# Check if executable exists
if [ ! -f "$NATIVE_DIR/vibetunnel" ]; then
    echo -e "${YELLOW}Warning: Executable not found at $NATIVE_DIR/vibetunnel${NC}"
    exit 0
fi

# Copy executable
echo "Copying executable..."
cp "$NATIVE_DIR/vibetunnel" "$DEST_RESOURCES/"
chmod +x "$DEST_RESOURCES/vibetunnel"

# Copy native modules
if [ -f "$NATIVE_DIR/pty.node" ]; then
    echo "Copying pty.node..."
    cp "$NATIVE_DIR/pty.node" "$DEST_RESOURCES/"
fi

if [ -f "$NATIVE_DIR/spawn-helper" ]; then
    echo "Copying spawn-helper..."
    cp "$NATIVE_DIR/spawn-helper" "$DEST_RESOURCES/"
    chmod +x "$DEST_RESOURCES/spawn-helper"
fi

echo -e "${GREEN}✓ Executable and native modules copied successfully${NC}"

# Verify the files
echo "Verifying copied files:"
ls -la "$DEST_RESOURCES/vibetunnel" "$DEST_RESOURCES/pty.node" "$DEST_RESOURCES/spawn-helper" 2>/dev/null || true