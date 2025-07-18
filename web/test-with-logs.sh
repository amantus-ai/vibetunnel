#!/bin/bash

# Kill any existing test
pkill -f "node test-capture-flow.js" 2>/dev/null

# Clear the log 
echo "Starting test..." > test-server.log

# Start monitoring the dev server output in background
# Find the dev server process and tail its output
DEV_PID=$(ps aux | grep "pnpm run dev" | grep -v grep | awk '{print $2}' | head -1)
if [ -n "$DEV_PID" ]; then
    # Use strace to capture output from the running process
    timeout 15s strace -p $DEV_PID -s 9999 -e write 2>&1 | grep -E "(desktop-capture|ffmpeg|capture|stream|webrtc|screencap)" >> test-server.log &
fi

# Give it a moment to start monitoring
sleep 1

# Run the test
echo "Running capture test..."
node test-capture-flow.js &
TEST_PID=$!

# Wait for test to complete
wait $TEST_PID

# Show relevant logs
echo -e "\n=== Server logs during test ==="
grep -i -E "(capture|ffmpeg|stream|error|exit|started|ended)" test-server.log | tail -50