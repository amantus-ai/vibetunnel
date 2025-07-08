#!/bin/bash

set -e

echo "Testing Homebrew dependency fix..."
echo "================================"

cd "$(dirname "$0")"

# Clean up existing builds
echo "1. Cleaning existing Node.js builds..."
rm -rf web/.node-builds

echo "2. Cleaning existing native builds..."
rm -rf web/native
rm -rf web/build

echo "3. Building custom Node.js without Homebrew dependencies..."
cd web
# Set clean build environment to avoid Homebrew contamination
export VIBETUNNEL_BUILD_CLEAN_ENV=true
node build-custom-node.js

echo ""
echo "4. Checking custom Node.js dependencies..."
CUSTOM_NODE=$(find .node-builds -name "node-v*-minimal" -type d -exec test -f {}/out/Release/node \; -print | sort -V | tail -n1)
if [ -n "$CUSTOM_NODE" ]; then
    echo "Custom Node.js found at: $CUSTOM_NODE"
    echo "Dependencies:"
    otool -L "$CUSTOM_NODE/out/Release/node" | grep -v "/usr/lib\|/System"
    echo ""
fi

echo "5. Building vibetunnel with custom Node.js..."
node build-native.js --custom-node

echo ""
echo "6. Checking vibetunnel dependencies..."
if [ -f native/vibetunnel ]; then
    echo "Dependencies of native/vibetunnel:"
    otool -L native/vibetunnel | grep -v "/usr/lib\|/System"
    
    # Check for Homebrew dependencies
    if otool -L native/vibetunnel | grep -q "/opt/homebrew\|/usr/local/Cellar"; then
        echo ""
        echo "❌ ERROR: Homebrew dependencies found!"
        otool -L native/vibetunnel | grep -E "/opt/homebrew|/usr/local/Cellar"
        exit 1
    else
        echo ""
        echo "✅ SUCCESS: No Homebrew dependencies found!"
    fi
else
    echo "❌ ERROR: native/vibetunnel not found!"
    exit 1
fi

echo ""
echo "7. Testing the binary..."
cd native
./vibetunnel --version

echo ""
echo "Test complete!"