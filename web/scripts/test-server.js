#!/usr/bin/env node

// Test server runner that builds and runs the JavaScript version to avoid tsx/node-pty issues
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectRoot = path.join(__dirname, '..');

// Build server TypeScript files
console.log('Building server TypeScript files for tests...');
try {
  execSync('pnpm exec tsc -p tsconfig.server.json', { 
    stdio: 'inherit',
    cwd: projectRoot
  });
} catch (error) {
  console.error('Failed to build server TypeScript files:', error);
  process.exit(1);
}

// Ensure native modules are available
execSync('node scripts/ensure-native-modules.js', { 
  stdio: 'inherit',
  cwd: projectRoot
});

// Forward all arguments to the built JavaScript version
const cliPath = path.join(projectRoot, 'dist/cli.js');

// Check if the built file exists
if (!fs.existsSync(cliPath)) {
  console.error(`Built CLI not found at ${cliPath}`);
  process.exit(1);
}

const args = [cliPath, ...process.argv.slice(2)];

// Spawn node with the built CLI
const child = spawn('node', args, {
  stdio: 'inherit',
  cwd: projectRoot,
  env: {
    ...process.env,
    // Ensure we're not in SEA mode for tests
    VIBETUNNEL_SEA: ''
  }
});

child.on('exit', (code) => {
  process.exit(code || 0);
});