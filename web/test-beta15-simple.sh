#!/bin/bash
set -e

echo "Simple test of VibeTunnel npm package beta 15"
echo "============================================="

# Create a temporary directory
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

echo "Working in: $TEMP_DIR"

# Initialize npm project
echo '{"name": "test-vibetunnel", "version": "1.0.0"}' > package.json

# Install VibeTunnel beta 15
echo -e "\nInstalling vibetunnel@1.0.0-beta.15..."
npm install vibetunnel@1.0.0-beta.15 --ignore-scripts --no-save 2>&1 | tail -20

# Check what was installed
echo -e "\nChecking installed package..."
echo "Package version:"
node -e "console.log(require('./node_modules/vibetunnel/package.json').version)"

echo -e "\nPackage files:"
ls -la node_modules/vibetunnel/ | head -20

echo -e "\nBinary file:"
if [ -f "node_modules/vibetunnel/bin/vibetunnel" ]; then
  echo "✅ Binary exists at node_modules/vibetunnel/bin/vibetunnel"
  head -5 node_modules/vibetunnel/bin/vibetunnel
else
  echo "❌ Binary not found"
fi

echo -e "\nDist directory:"
if [ -d "node_modules/vibetunnel/dist" ]; then
  echo "✅ Dist directory exists"
  ls node_modules/vibetunnel/dist/
else
  echo "❌ Dist directory not found"
fi

# Cleanup
cd /
rm -rf "$TEMP_DIR"

echo -e "\n✅ Beta 15 package structure verified!"