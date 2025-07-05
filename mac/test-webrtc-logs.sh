#!/bin/bash

echo "=== Testing WebRTC Manager Creation ==="
echo "Current time: $(date)"
echo ""

# First, kill any existing VibeTunnel process
echo "Killing existing VibeTunnel processes..."
pkill -f "VibeTunnel.app"
sleep 2

# Start logging in background
echo "Starting log capture..."
log stream --predicate 'subsystem == "sh.vibetunnel.vibetunnel"' --style compact > /tmp/vibetunnel-test.log 2>&1 &
LOG_PID=$!

# Give logging time to start
sleep 1

# Now trigger the test by opening the screencap interface
echo "Opening screencap interface to trigger WebRTC creation..."
open "http://localhost:4020/screencap"

# Wait for logs
echo "Waiting for logs to accumulate..."
sleep 5

# Kill log stream
kill $LOG_PID 2>/dev/null

# Check what we captured
echo ""
echo "=== Log Analysis ==="
echo "Looking for WebRTC-related messages:"
grep -E "WebRTC|socket|auth|screencap|mac-ready" /tmp/vibetunnel-test.log | grep -v "CLIENT:" | head -20

echo ""
echo "Looking for ScreencapService messages:"
grep -E "ScreencapService|Using server URL" /tmp/vibetunnel-test.log | head -10

echo ""
echo "Full log saved to: /tmp/vibetunnel-test.log"