#!/bin/bash

echo "Testing FFmpeg screen capture..."
echo "DISPLAY: $DISPLAY"

# Test 1: Basic capture to file
echo -e "\n1. Testing basic capture to file..."
timeout 3 ffmpeg -f x11grab -framerate 30 -video_size 1920x1080 -i :0.0 -c:v libvpx -b:v 2500k -f webm test-capture.webm 2>&1 | grep -E "(Input|Output|Stream|Error|error)"

if [ -f test-capture.webm ]; then
    SIZE=$(stat -c%s test-capture.webm)
    echo "✓ Capture file created: $SIZE bytes"
    rm test-capture.webm
else
    echo "✗ No capture file created"
fi

# Test 2: Capture to stdout
echo -e "\n2. Testing capture to stdout..."
timeout 3 ffmpeg -f x11grab -framerate 30 -video_size 1920x1080 -i :0.0 -c:v libvpx -b:v 2500k -f webm - 2>/dev/null | wc -c | xargs -I {} echo "✓ Captured {} bytes to stdout"

# Test 3: Check display info
echo -e "\n3. Checking display info..."
xdpyinfo | grep -E "(dimensions|screen #)" || echo "✗ xdpyinfo failed"

echo -e "\nTest complete."