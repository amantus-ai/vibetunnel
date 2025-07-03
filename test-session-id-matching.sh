#!/bin/bash
# Test script to verify enhanced window matching with session IDs

echo "=== Testing Enhanced Window Matching with Session IDs ==="
echo
echo "This test will verify that VibeTunnel correctly identifies windows"
echo "when multiple terminal windows are open from the same app."
echo

# Test 1: Terminal.app with multiple windows
echo "TEST 1: Terminal.app - Multiple Windows"
echo "1. Open VibeTunnel app"
echo "2. Create TWO sessions with different commands:"
echo "   - First: 'echo \"Window 1\" && sleep 60'"
echo "   - Second: 'echo \"Window 2\" && sleep 60'"
echo "3. Check that both Terminal windows show their session IDs in the title bar"
echo "4. Try killing each session from VibeTunnel"
echo "5. Verify the CORRECT window closes each time"
echo
read -p "Press Enter when ready to continue to Test 2..."

# Test 2: iTerm2 with multiple windows
echo
echo "TEST 2: iTerm2 - Multiple Windows (if installed)"
echo "1. Switch terminal preference to iTerm2"
echo "2. Create TWO sessions similar to Test 1"
echo "3. Check that iTerm2 tabs/windows show 'Session {ID}' in their titles"
echo "4. Kill sessions and verify correct windows close"
echo
read -p "Press Enter when ready to continue to Test 3..."

# Test 3: Window focus with multiple windows
echo
echo "TEST 3: Window Focus - Multiple Windows"
echo "1. Create multiple sessions in Terminal.app"
echo "2. Click on different sessions in VibeTunnel UI"
echo "3. Verify the CORRECT window is brought to front each time"
echo "4. This tests both our enhanced matching logic"
echo
echo "Test complete!"
echo
echo "Summary: With our enhancement, VibeTunnel now uses session IDs in window titles"
echo "to accurately identify windows when multiple are open from the same terminal app."