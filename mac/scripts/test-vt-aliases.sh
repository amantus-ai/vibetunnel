#!/bin/bash
set -e

# Integration tests for alias functionality
# Tests the core fix: removing -- separator from shell commands

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="${PROJECT_DIR}/build/Build/Products/Debug"
APP_PATH="${BUILD_DIR}/VibeTunnel.app"
VIBETUNNEL_BIN="${APP_PATH}/Contents/Resources/vibetunnel"

# Colors for output  
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Function to run a test
run_test() {
    local test_name="$1"
    local test_command="$2"
    local expected_output="$3"
    
    TESTS_RUN=$((TESTS_RUN + 1))
    
    echo -n "Testing: $test_name... "
    
    # Run the command
    if output=$(eval "$test_command" 2>&1); then
        if echo "$output" | grep -q -- "$expected_output"; then
            echo -e "${GREEN}PASSED${NC}"
            TESTS_PASSED=$((TESTS_PASSED + 1))
        else
            echo -e "${RED}FAILED${NC}"
            echo "  Expected to find: '$expected_output'"
            echo "  Actual output: '$output'"
            TESTS_FAILED=$((TESTS_FAILED + 1))
        fi
    else
        exit_code=$?
        echo -e "${RED}FAILED${NC} (exit code: $exit_code)"
        echo "  Command: $test_command"
        echo "  Output: $output"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

# Check if vibetunnel exists
if [ ! -f "$VIBETUNNEL_BIN" ]; then
    echo -e "${RED}Error: vibetunnel not found at $VIBETUNNEL_BIN${NC}"
    echo "Please build the Debug configuration first: ./scripts/build.sh --configuration Debug"
    exit 1
fi

echo "Testing alias functionality fix..."
echo "Using vibetunnel at: $VIBETUNNEL_BIN"
echo ""

# Test 1: Direct command execution (should work)
run_test "Direct command execution" \
    "$VIBETUNNEL_BIN fwd echo 'test direct'" \
    "test direct"

# Test 2: Shell command with proper formatting (simulates fixed vt behavior)
run_test "Shell command without -- separator" \
    "$VIBETUNNEL_BIN fwd /bin/zsh -i -c \"echo 'alias test works'\"" \
    "alias test works"

# Test 3: Test that -- can be passed as an argument
run_test "Command with -- as argument" \
    "$VIBETUNNEL_BIN fwd echo -- test" \
    "-- test"

# Test 4: Complex shell command (simulates alias resolution)
TEMP_DIR=$(mktemp -d)
cat > "$TEMP_DIR/.zshrc" << 'EOF'
alias myalias="echo 'real alias output'"
EOF

run_test "Zsh alias resolution" \
    "ZDOTDIR=$TEMP_DIR $VIBETUNNEL_BIN fwd /bin/zsh -i -c 'myalias'" \
    "real alias output"

# Test 5: Bash alias resolution
TEMP_DIR_BASH=$(mktemp -d)
cat > "$TEMP_DIR_BASH/.bashrc" << 'EOF'
alias myalias="echo 'bash alias output'"
EOF

run_test "Bash alias resolution" \
    "HOME=$TEMP_DIR_BASH $VIBETUNNEL_BIN fwd /bin/bash -c 'shopt -s expand_aliases; source ~/.bashrc 2>/dev/null || true; myalias'" \
    "bash alias output"

# Test 6: Shell function
TEMP_DIR_FUNC=$(mktemp -d)
cat > "$TEMP_DIR_FUNC/.zshrc" << 'EOF'
myfunc() {
    echo "function output: $1"
}
EOF

run_test "Zsh function resolution" \
    "ZDOTDIR=$TEMP_DIR_FUNC $VIBETUNNEL_BIN fwd /bin/zsh -i -c 'myfunc testarg'" \
    "function output: testarg"

# Cleanup
rm -rf "$TEMP_DIR" "$TEMP_DIR_BASH" "$TEMP_DIR_FUNC"

# Summary
echo ""
echo "========================================"
echo "Test Summary:"
echo "  Total tests: $TESTS_RUN"
echo -e "  Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "  Failed: ${RED}$TESTS_FAILED${NC}"
echo "========================================"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
fi
