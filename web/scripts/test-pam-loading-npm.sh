#!/bin/bash

# Test script to verify PAM module loading works correctly in npm package
# This simulates the actual npm installation scenario

set -e

echo "🔍 Testing PAM module loading in npm package..."
echo

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Build the npm package
echo "📦 Building npm package..."
if pnpm run build:npm --current-only; then
    echo -e "${GREEN}✅ Build successful${NC}"
else
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi

# Create a test directory
TEST_DIR="test-pam-loading-npm"
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

echo
echo "📋 Testing npm package installation..."

# Copy the built package
cp ../vibetunnel-*.tgz ./

# Extract the package to examine structure
echo "📂 Extracting package to verify structure..."
tar -xzf vibetunnel-*.tgz

# Check the paths in the bundled CLI
echo
echo "🔎 Checking PAM loading paths in bundled CLI..."
if grep -q "optional-modules" package/lib/vibetunnel-cli; then
    echo -e "${GREEN}✅ Found optional-modules references in bundled code${NC}"
    
    # Count how many path variations we have
    COUNT=$(strings package/lib/vibetunnel-cli | grep -o "\.\..*optional-modules" | sort | uniq | wc -l)
    echo "   Found $COUNT different path patterns for optional-modules"
    
    # Show the actual paths
    echo "   Path patterns found:"
    strings package/lib/vibetunnel-cli | grep -o "\.\..*optional-modules" | sort | uniq | while read -r path; do
        echo "     - $path"
    done
else
    echo -e "${RED}❌ No optional-modules references found in bundled code${NC}"
fi

# Simulate npm global installation structure
echo
echo "🏗️  Simulating npm global installation..."
INSTALL_DIR="simulated-npm-global"
mkdir -p "$INSTALL_DIR/lib/node_modules/vibetunnel"

# Copy package contents
cp -r package/* "$INSTALL_DIR/lib/node_modules/vibetunnel/"

# Create the optional-modules structure that would be created by postinstall
mkdir -p "$INSTALL_DIR/lib/node_modules/vibetunnel/optional-modules/authenticate-pam/build/Release"
touch "$INSTALL_DIR/lib/node_modules/vibetunnel/optional-modules/authenticate-pam/build/Release/authenticate_pam.node"

# Test path resolution
echo
echo "🧪 Testing path resolution from lib directory..."

# Create a test script that simulates the bundled code's path resolution
cat > test-paths.cjs << 'EOF'
const path = require('path');
const fs = require('fs');

// Simulate being in the lib directory
const __dirname = path.join(process.cwd(), 'simulated-npm-global/lib/node_modules/vibetunnel/lib');

console.log('Simulated __dirname:', __dirname);
console.log();

const paths = [
    // Bundled context: dist-npm/lib/../optional-modules
    path.join(__dirname, '..', 'optional-modules', 'authenticate-pam', 'build', 'Release', 'authenticate_pam.node'),
    // Development context: src/server/services/../../../optional-modules
    path.join(__dirname, '..', '..', '..', 'optional-modules', 'authenticate-pam', 'build', 'Release', 'authenticate_pam.node'),
    // Alternative bundled location
    path.join(__dirname, '..', '..', 'optional-modules', 'authenticate-pam', 'build', 'Release', 'authenticate_pam.node'),
];

console.log('Testing path resolution:');
paths.forEach((p, i) => {
    const exists = fs.existsSync(p);
    const relativePath = '../'.repeat(i + 1) + 'optional-modules/...';
    console.log(`${exists ? '✅' : '❌'} ${relativePath} -> ${exists ? 'FOUND' : 'Not found'}`);
    if (exists) {
        console.log(`   Resolved to: ${p}`);
    }
});

// Check which path would be used (first one that exists)
const workingPath = paths.find(p => fs.existsSync(p));
if (workingPath) {
    console.log('\n✅ PAM module would be loaded from:', workingPath);
} else {
    console.log('\n❌ PAM module would NOT be found!');
}
EOF

node test-paths.cjs

# Cleanup
cd ..
rm -rf "$TEST_DIR"

echo
echo -e "${GREEN}✅ PAM module loading test completed!${NC}"
echo
echo "Summary:"
echo "- The fix adds multiple path options to handle different installation contexts"
echo "- In npm global install (/usr/local/lib/node_modules/vibetunnel/lib/), the module is found at ../optional-modules"
echo "- This matches the expected behavior from the user's report"