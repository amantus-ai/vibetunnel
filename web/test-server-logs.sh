#!/bin/bash
echo "Starting server and monitoring logs..."

# Kill any existing server
pkill -f "pnpm run dev" || true
pkill -f "tsx.*server.ts" || true

# Start server in background and capture logs
cd /home/parallels/projects/vibetunnel/web
pnpm run dev > server-test.log 2>&1 &
SERVER_PID=$!

echo "Server started with PID: $SERVER_PID"
echo "Waiting for server to start..."
sleep 3

# Run the test
echo "Running test..."
timeout 10 node test-final-debug.js

# Wait a bit more
sleep 2

# Show relevant server logs
echo -e "\n=== FFmpeg and capture logs ==="
grep -E "(FFmpeg|desktop-capture|screencap-handler|webrtc-handler|capture-1752)" server-test.log | tail -50

# Kill server
kill $SERVER_PID 2>/dev/null || true

echo -e "\nTest complete."