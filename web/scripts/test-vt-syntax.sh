#!/bin/bash
# Test script to validate vt command syntax and basic functionality
# This can be run as part of the build process to catch issues early

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VT_SCRIPT="$PROJECT_ROOT/bin/vt"

echo "Testing vt command syntax and functionality..."

# Test 1: Check if vt script exists
if [ ! -f "$VT_SCRIPT" ]; then
    echo "❌ ERROR: vt script not found at $VT_SCRIPT"
    exit 1
fi
echo "✅ vt script exists"

# Test 2: Check if vt script is executable
if [ ! -x "$VT_SCRIPT" ]; then
    echo "❌ ERROR: vt script is not executable"
    exit 1
fi
echo "✅ vt script is executable"

# Test 3: Validate bash syntax
if ! bash -n "$VT_SCRIPT" 2>/dev/null; then
    echo "❌ ERROR: vt script has syntax errors"
    bash -n "$VT_SCRIPT" # Show the actual errors
    exit 1
fi
echo "✅ vt script has valid bash syntax"

# Test 4: Check if vt script contains required functions
if ! grep -q "show_help()" "$VT_SCRIPT"; then
    echo "❌ ERROR: vt script missing show_help() function"
    exit 1
fi
echo "✅ vt script contains show_help() function"

if ! grep -q "resolve_command()" "$VT_SCRIPT"; then
    echo "❌ ERROR: vt script missing resolve_command() function"
    exit 1
fi
echo "✅ vt script contains resolve_command() function"

# Test 5: Check for empty if statements (the bug we fixed)
# Use a simpler approach that works on macOS
if awk '/if.*then/{start=NR; in_if=1; has_content=0} in_if && !/^[[:space:]]*#/ && !/^[[:space:]]*$/ && !/if.*then/ && !/fi$/{has_content=1} /^[[:space:]]*fi$/ && in_if{if(!has_content) print "Empty if at line " start; in_if=0}' "$VT_SCRIPT" | grep -q .; then
    echo "❌ ERROR: vt script contains empty if statements"
    exit 1
fi
echo "✅ vt script has no empty if statements"

# Test 6: Check if package.json includes vt in bin section
PACKAGE_JSON="$PROJECT_ROOT/package.json"
if [ -f "$PACKAGE_JSON" ]; then
    if ! grep -q '"vt".*:.*"./bin/vt"' "$PACKAGE_JSON"; then
        echo "❌ ERROR: package.json missing vt in bin section"
        exit 1
    fi
    echo "✅ package.json includes vt in bin section"
fi

# Test 7: Basic functionality test (help command)
# Use gtimeout if available, otherwise skip timeout
if command -v gtimeout >/dev/null 2>&1; then
    if ! gtimeout 5 "$VT_SCRIPT" --help >/dev/null 2>&1; then
        echo "❌ ERROR: vt --help command failed or timed out"
        exit 1
    fi
else
    # On macOS without gtimeout, just test that it doesn't immediately fail
    if ! "$VT_SCRIPT" --help >/dev/null 2>&1; then
        echo "❌ ERROR: vt --help command failed"
        exit 1
    fi
fi
echo "✅ vt --help command works"

echo "🎉 All vt command tests passed!"