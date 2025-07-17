#!/bin/bash
# Test script to validate postinstall vt installation behavior

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
POSTINSTALL_SCRIPT="$PROJECT_ROOT/scripts/postinstall-npm.js"

echo "Testing postinstall vt installation behavior..."

# Create a temporary directory for testing
TEST_DIR=$(mktemp -d)
trap "rm -rf $TEST_DIR" EXIT

# Test 1: Test with existing vt command
echo ""
echo "Test 1: Existing vt command should not be overwritten"
mkdir -p "$TEST_DIR/bin"
echo '#!/bin/bash' > "$TEST_DIR/bin/vt"
echo 'echo "existing vt command"' >> "$TEST_DIR/bin/vt"
chmod +x "$TEST_DIR/bin/vt"

# Simulate global install with existing vt
(
  cd "$PROJECT_ROOT"
  # Mock npm config get prefix to return our test directory
  npm() {
    if [[ "$1" == "config" && "$2" == "get" && "$3" == "prefix" ]]; then
      echo "$TEST_DIR"
    else
      command npm "$@"
    fi
  }
  export -f npm
  export npm_config_global=true
  
  # Run just the vt installation part
  node -e "
    const fs = require('fs');
    const path = require('path');
    const { execSync } = require('child_process');
    
    // Mock execSync to intercept npm config calls
    const originalExecSync = execSync;
    require('child_process').execSync = (cmd, opts) => {
      if (cmd.includes('npm config get prefix')) {
        return '$TEST_DIR\\n';
      }
      return originalExecSync(cmd, opts);
    };
    
    // Load and run the vt installation functions
    $(sed -n '/^\/\/ Helper function to get npm global bin directory$/,/^\/\/ Install vt symlink\/wrapper$/p' "$POSTINSTALL_SCRIPT" | sed 's/console\./\/\/console./g')
    
    const vtSource = path.join('$PROJECT_ROOT', 'bin', 'vt');
    const result = installVtCommand(vtSource, true);
    
    // Check if existing vt was preserved
    const existingContent = fs.readFileSync('$TEST_DIR/bin/vt', 'utf8');
    if (existingContent.includes('existing vt command')) {
      console.log('✅ Test 1 passed: Existing vt command was preserved');
    } else {
      console.log('❌ Test 1 failed: Existing vt command was overwritten');
      process.exit(1);
    }
  "
)

# Test 2: Test without existing vt command
echo ""
echo "Test 2: vt should be installed when not present"
rm -f "$TEST_DIR/bin/vt"

(
  cd "$PROJECT_ROOT"
  # Mock npm config get prefix to return our test directory
  npm() {
    if [[ "$1" == "config" && "$2" == "get" && "$3" == "prefix" ]]; then
      echo "$TEST_DIR"
    else
      command npm "$@"
    fi
  }
  export -f npm
  export npm_config_global=true
  
  # Run just the vt installation part
  node -e "
    const fs = require('fs');
    const path = require('path');
    const { execSync } = require('child_process');
    
    // Mock execSync to intercept npm config calls
    const originalExecSync = execSync;
    require('child_process').execSync = (cmd, opts) => {
      if (cmd.includes('npm config get prefix')) {
        return '$TEST_DIR\\n';
      }
      return originalExecSync(cmd, opts);
    };
    
    // Load and run the vt installation functions
    $(sed -n '/^\/\/ Helper function to get npm global bin directory$/,/^\/\/ Install vt symlink\/wrapper$/p' "$POSTINSTALL_SCRIPT" | sed 's/console\./\/\/console./g')
    
    const vtSource = path.join('$PROJECT_ROOT', 'bin', 'vt');
    const result = installVtCommand(vtSource, true);
    
    // Check if vt was installed
    if (fs.existsSync('$TEST_DIR/bin/vt')) {
      console.log('✅ Test 2 passed: vt command was installed');
    } else {
      console.log('❌ Test 2 failed: vt command was not installed');
      process.exit(1);
    }
  "
)

# Test 3: Test local install behavior
echo ""
echo "Test 3: Local install should not create global symlink"
rm -f "$TEST_DIR/bin/vt"

(
  cd "$PROJECT_ROOT"
  # Run just the vt installation part for local install
  node -e "
    const fs = require('fs');
    const path = require('path');
    const { execSync } = require('child_process');
    
    // Load the vt installation functions
    $(sed -n '/^\/\/ Helper function to get npm global bin directory$/,/^\/\/ Install vt symlink\/wrapper$/p' "$POSTINSTALL_SCRIPT" | sed 's/console\./\/\/console./g')
    
    const vtSource = path.join('$PROJECT_ROOT', 'bin', 'vt');
    const result = installVtCommand(vtSource, false); // local install
    
    // Check that no global vt was created
    if (!fs.existsSync('$TEST_DIR/bin/vt')) {
      console.log('✅ Test 3 passed: No global vt created for local install');
    } else {
      console.log('❌ Test 3 failed: Global vt was created for local install');
      process.exit(1);
    }
  "
)

echo ""
echo "🎉 All postinstall vt tests passed!"