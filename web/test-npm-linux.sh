#!/bin/bash
# Test script for npm package on Linux

echo "Testing VibeTunnel npm package installation on Linux..."
echo

# Test 1: Check if commands exist
echo "=== Test 1: Command existence ==="
which vibetunnel && echo "✓ vibetunnel command found" || echo "✗ vibetunnel command not found"
which vt && echo "✓ vt command found" || echo "✗ vt command not found"
echo

# Test 2: Test version flag
echo "=== Test 2: Version check ==="
vibetunnel --version && echo "✓ Version check passed" || echo "✗ Version check failed"
echo

# Test 3: Test help flag
echo "=== Test 3: Help check ==="
vibetunnel --help > /dev/null 2>&1 && echo "✓ Help check passed" || echo "✗ Help check failed"
echo

# Test 4: Check if node-pty is properly loaded with prebuilds
echo "=== Test 4: Node-pty loading test ==="
node -e "
try {
  require('node-pty');
  console.log('✓ node-pty loaded successfully');
} catch (e) {
  console.log('✗ node-pty failed to load:', e.message);
}
"
echo

# Test 5: Check if authenticate-pam is properly loaded
echo "=== Test 5: authenticate-pam loading test ==="
node -e "
try {
  require('authenticate-pam');
  console.log('✓ authenticate-pam loaded successfully');
} catch (e) {
  console.log('✗ authenticate-pam failed to load:', e.message);
}
"
echo

echo "=== Test Summary ==="
echo "All tests completed. Check results above."