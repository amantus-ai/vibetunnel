#!/bin/bash
set -e

# Focused integration test for PR #132 fix
# Tests that removing -- separator fixes alias functionality

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="${PROJECT_DIR}/build/Build/Products/Debug"
APP_PATH="${BUILD_DIR}/VibeTunnel.app"
VIBETUNNEL_BIN="${APP_PATH}/Contents/Resources/vibetunnel"

# Colors for output  
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo "Testing PR #132 fix: alias functionality without -- separator"
echo ""

# Check if vibetunnel exists
if [ ! -f "$VIBETUNNEL_BIN" ]; then
    echo -e "${RED}Error: vibetunnel not found at $VIBETUNNEL_BIN${NC}"
    echo "Please build the Debug configuration first"
    exit 1
fi

# Test the core issue: shell commands work without -- separator
echo -n "Test 1: Shell command execution (simulating vt alias resolution)... "

# This is what vt sends after the fix (no -- separator)
output=$("$VIBETUNNEL_BIN" fwd /bin/sh -c "echo 'SUCCESS: alias would work'" 2>&1)

if echo "$output" | grep -q "SUCCESS: alias would work"; then
    echo -e "${GREEN}PASSED${NC}"
    echo "  ✓ Shell command executed correctly without -- separator"
else
    echo -e "${RED}FAILED${NC}"
    echo "  ✗ Expected: 'SUCCESS: alias would work'"
    echo "  ✗ Got: $output"
    exit 1
fi

# Test that fwd.ts now handles -- correctly if present
echo -n "Test 2: fwd.ts handles -- as argument separator... "

# Updated fwd.ts should strip -- if it's the first argument
output=$("$VIBETUNNEL_BIN" fwd -- echo "test with separator" 2>&1)

if echo "$output" | grep -q "test with separator"; then
    echo -e "${GREEN}PASSED${NC}"
    echo "  ✓ fwd.ts correctly handles -- separator"
else
    echo -e "${RED}FAILED${NC}"
    echo "  ✗ Expected: 'test with separator'"
    echo "  ✗ Got: $output"
    exit 1
fi

echo ""
echo -e "${GREEN}All PR #132 tests passed!${NC}"
echo "The fix correctly removes -- separator from vt script calls."