#!/bin/bash

# Test script for vt title functionality

echo "=== VibeTunnel Title Update Test ==="
echo

# Function to test title update
test_title_update() {
    local mode=$1
    local expected_behavior=$2
    
    echo "Testing title update with mode: $mode"
    echo "Expected: $expected_behavior"
    echo
    
    # Start a VibeTunnel session with the specified mode
    echo "1. Start a session with: vt --title-mode $mode bash"
    echo "2. Inside the session, run: vt title \"Test Title $mode\""
    echo "3. Observe the terminal title"
    echo
}

echo "Test Cases:"
echo "-----------"
test_title_update "none" "No title change (apps control titles)"
test_title_update "filter" "No title change (all changes blocked)"
test_title_update "static" "Title updates to include 'Test Title static'"
test_title_update "dynamic" "Title updates with activity indicator and 'Test Title dynamic'"

echo
echo "Manual Testing Steps:"
echo "--------------------"
echo "1. Open a new terminal"
echo "2. Run each test case above"
echo "3. Verify the title behavior matches expectations"
echo
echo "For automated verification:"
echo "- Check ~/.vibetunnel/control/*/session.json after running vt title"
echo "- The 'name' field should be updated"