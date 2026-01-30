#!/bin/bash
set -e

# Integration tests for vt command alias functionality
# This script tests that vt properly handles aliases, functions, and regular commands

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="${PROJECT_DIR}/build/Build/Products/Debug"
APP_PATH="${BUILD_DIR}/VibeTunnel.app"
VT_PATH="${APP_PATH}/Contents/Resources/vt"
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
    local timeout="${4:-5}"  # Default 5 second timeout
    
    TESTS_RUN=$((TESTS_RUN + 1))
    
    echo -n "Testing: $test_name... "
    
    # Run the command with timeout
    if output=$(timeout "$timeout" bash -c "$test_command" 2>&1); then
        if echo "$output" | grep -q "$expected_output"; then
            echo -e "${GREEN}PASSED${NC}"
            TESTS_PASSED=$((TESTS_PASSED + 1))
        else
            echo -e "${RED}FAILED${NC}"
            echo "  Expected to find: '$expected_output'"
            echo "  Actual output: '$output'"
            TESTS_FAILED=$((TESTS_FAILED + 1))
        fi
    else
        echo -e "${RED}FAILED${NC} (command failed or timed out)"
        echo "  Command: $test_command"
        echo "  Output: $output"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

# Check if vt exists
if [ ! -f "$VT_PATH" ]; then
    echo -e "${RED}Error: vt not found at $VT_PATH${NC}"
    echo "Please build the Debug configuration first: ./scripts/build.sh --configuration Debug"
    exit 1
fi

# Make sure vt is executable
chmod +x "$VT_PATH"

echo "Running vt integration tests..."
echo "Using vt at: $VT_PATH"
echo ""

# Test 1: Basic command execution (binary in PATH)
run_test "Basic command (echo)" \
    "$VT_PATH echo 'Hello from vt'" \
    "Hello from vt"

# Test 2: Command with flags
run_test "Command with flags (ls)" \
    "$VT_PATH ls -la /tmp | head -1" \
    "total"

# Test 3: Test zsh alias
# Create a temporary directory with zsh config
TEMP_ZSH_DIR=$(mktemp -d)
cat > "$TEMP_ZSH_DIR/.zshrc" << 'EOF'
alias testalias="echo 'zsh alias works'"
EOF

run_test "Zsh alias" \
    "ZDOTDIR=$TEMP_ZSH_DIR HOME=$TEMP_ZSH_DIR $VT_PATH testalias" \
    "zsh alias works"

# Test 4: Test bash alias
# Create a temporary directory with bash config
TEMP_BASH_DIR=$(mktemp -d)
cat > "$TEMP_BASH_DIR/.bashrc" << 'EOF'
alias testalias="echo 'bash alias works'"
EOF

run_test "Bash alias" \
    "SHELL=/bin/bash HOME=$TEMP_BASH_DIR $VT_PATH testalias" \
    "bash alias works"

# Test 5: Test shell function
TEMP_FUNC_DIR=$(mktemp -d)
cat > "$TEMP_FUNC_DIR/.zshrc" << 'EOF'
testfunc() {
    echo "shell function works: $1"
}
EOF

run_test "Zsh function" \
    "ZDOTDIR=$TEMP_FUNC_DIR HOME=$TEMP_FUNC_DIR $VT_PATH testfunc argument" \
    "shell function works: argument"

# Test 6: Test command with special characters
run_test "Command with special chars" \
    "$VT_PATH echo 'test & special | chars'" \
    "test & special | chars"

# Test 7: Test --no-shell-wrap flag
run_test "No shell wrap flag" \
    "$VT_PATH --no-shell-wrap echo 'direct execution'" \
    "direct execution"

# Test 8: Test -S flag (short form of --no-shell-wrap)
run_test "-S flag" \
    "$VT_PATH -S echo 'direct with -S'" \
    "direct with -S"

# Test 9: Test piped commands
run_test "Piped commands" \
    "$VT_PATH sh -c 'echo hello | tr a-z A-Z'" \
    "HELLO"

# Test 10: Test command not found
run_test "Command not found" \
    "$VT_PATH nonexistentcommand123 2>&1 || true" \
    "command not found"

# Test 11: Test interactive shell launch
run_test "Interactive shell (-i)" \
    "echo 'exit' | $VT_PATH -i 2>&1 | head -1" \
    "vibetunnel"

# Test 12: Test --shell flag
run_test "Shell flag (--shell)" \
    "echo 'exit' | $VT_PATH --shell 2>&1 | head -1" \
    "vibetunnel"

# Cleanup
rm -rf "$TEMP_ZSH_DIR" "$TEMP_BASH_DIR" "$TEMP_FUNC_DIR"

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