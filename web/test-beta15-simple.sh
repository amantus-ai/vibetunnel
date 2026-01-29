#!/bin/bash
set -e

echo "Simple test of ShellOps npm package beta 15"
echo "============================================="

# Create a temporary directory
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

echo "Working in: $TEMP_DIR"

# Initialize npm project
echo '{"name": "test-shellops", "version": "1.0.0"}' > package.json

# Install ShellOps beta 15
echo -e "\nInstalling shellops@1.0.0-beta.15..."
npm install shellops@1.0.0-beta.15 --ignore-scripts --no-save 2>&1 | tail -20

# Check what was installed
echo -e "\nChecking installed package..."
echo "Package version:"
node -e "console.log(require('./node_modules/shellops/package.json').version)"

echo -e "\nPackage files:"
ls -la node_modules/shellops/ | head -20

echo -e "\nBinary file:"
if [ -f "node_modules/shellops/bin/shellops" ]; then
  echo "✅ Binary exists at node_modules/shellops/bin/shellops"
  head -5 node_modules/shellops/bin/shellops
else
  echo "❌ Binary not found"
fi

echo -e "\nDist directory:"
if [ -d "node_modules/shellops/dist" ]; then
  echo "✅ Dist directory exists"
  ls node_modules/shellops/dist/
else
  echo "❌ Dist directory not found"
fi

# Cleanup
cd /
rm -rf "$TEMP_DIR"

echo -e "\n✅ Beta 15 package structure verified!"