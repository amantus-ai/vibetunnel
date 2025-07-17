#!/usr/bin/env node

/**
 * Test script to verify PAM module loading in different contexts
 * This tests both the development and bundled scenarios
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔍 Testing PAM module loading paths...\n');

// Check if we're in the web directory
if (!fs.existsSync('package.json') || !fs.existsSync('src/server/services/authenticate-pam-loader.ts')) {
  console.error('❌ This script must be run from the web directory');
  process.exit(1);
}

// Test 1: Development context
console.log('1️⃣ Testing development context...');
try {
  const devResult = execSync('node -e "require(\'./src/server/services/authenticate-pam-loader.ts\')"', {
    encoding: 'utf8',
    stdio: 'pipe'
  });
  console.log('   ✅ Development context loads (or fails gracefully)');
} catch (error) {
  // TypeScript file, expected to fail in direct node execution
  console.log('   ℹ️  Development context requires TypeScript compilation');
}

// Test 2: Build and test bundled context
console.log('\n2️⃣ Building npm package to test bundled context...');
try {
  // Build with current platform only for speed
  console.log('   Building...');
  execSync('pnpm run build:npm --current-only', { stdio: 'inherit' });
  
  console.log('\n3️⃣ Testing bundled context paths...');
  
  // Check if the bundled file exists
  const bundledCliPath = path.join(__dirname, '..', 'dist-npm', 'lib', 'cli.js');
  if (!fs.existsSync(bundledCliPath)) {
    console.error('   ❌ Bundled CLI not found at:', bundledCliPath);
    process.exit(1);
  }
  
  // Extract and check the actual paths in the bundled code
  const bundledContent = fs.readFileSync(bundledCliPath, 'utf8');
  
  // Look for the path patterns
  const pathPatterns = [
    /path\.join\([^,]+,\s*["']\.\.["'],\s*["']optional-modules["']/g,
    /path\.join\([^,]+,\s*["']\.\.["'],\s*["']\.\.["'],\s*["']optional-modules["']/g,
    /path\.join\([^,]+,\s*["']\.\.["'],\s*["']\.\.["'],\s*["']\.\.["'],\s*["']optional-modules["']/g,
  ];
  
  console.log('   Checking path patterns in bundled code:');
  let foundPaths = false;
  
  pathPatterns.forEach((pattern, index) => {
    const matches = bundledContent.match(pattern);
    const depth = index + 1;
    if (matches) {
      console.log(`   ✅ Found path with ${depth} parent dir(s): ../`.repeat(depth) + 'optional-modules');
      foundPaths = true;
    }
  });
  
  if (!foundPaths) {
    console.log('   ⚠️  Could not find optional-modules paths in bundled code');
  }
  
  // Test 3: Simulate the actual loading scenario
  console.log('\n4️⃣ Simulating module loading scenarios...');
  
  // Create a test structure
  const testDir = path.join(__dirname, '..', 'test-pam-loading');
  const libDir = path.join(testDir, 'lib');
  const optionalModulesDir = path.join(testDir, 'optional-modules', 'authenticate-pam', 'build', 'Release');
  
  // Clean up any existing test directory
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true });
  }
  
  // Create test structure
  fs.mkdirSync(libDir, { recursive: true });
  fs.mkdirSync(optionalModulesDir, { recursive: true });
  
  // Create a dummy module file
  fs.writeFileSync(path.join(optionalModulesDir, 'authenticate_pam.node'), 'dummy');
  
  // Test path resolution from lib directory
  const testScript = `
    const path = require('path');
    const fs = require('fs');
    const __dirname = '${libDir}';
    
    const paths = [
      path.join(__dirname, '..', 'optional-modules', 'authenticate-pam', 'build', 'Release', 'authenticate_pam.node'),
      path.join(__dirname, '..', '..', 'optional-modules', 'authenticate-pam', 'build', 'Release', 'authenticate_pam.node'),
      path.join(__dirname, '..', '..', '..', 'optional-modules', 'authenticate-pam', 'build', 'Release', 'authenticate_pam.node'),
    ];
    
    console.log('   Testing path resolution from lib directory:');
    paths.forEach((p, i) => {
      const exists = fs.existsSync(p);
      const relativePath = '../'.repeat(i + 1) + 'optional-modules/...';
      console.log(\`   \${exists ? '✅' : '❌'} \${relativePath} -> \${exists ? 'Found' : 'Not found'}\`);
    });
  `;
  
  eval(testScript);
  
  // Clean up test directory
  fs.rmSync(testDir, { recursive: true });
  
  console.log('\n✅ PAM module loading path test completed!');
  console.log('\nSummary:');
  console.log('- The fix adds multiple path options to handle both development and bundled contexts');
  console.log('- In bundled context (dist-npm/lib/), the module should be found at ../optional-modules');
  console.log('- In development context (src/server/services/), the module should be found at ../../../optional-modules');
  
} catch (error) {
  console.error('❌ Build or test failed:', error.message);
  process.exit(1);
}