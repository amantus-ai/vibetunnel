#!/usr/bin/env node

/**
 * Ensures native modules are built and available for tests
 * This script handles the native PTY addon built with napi-rs
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Ensuring native modules are built for tests...');

// Check if vibetunnel-pty addon is built
const vibetunnelPtyPath = path.join(__dirname, '../vibetunnel-pty/index.node');

if (!fs.existsSync(vibetunnelPtyPath)) {
  console.log('VibeTunnel PTY addon not found, building...');
  
  try {
    // Build the native addon
    execSync('cd vibetunnel-pty && npm run build', {
      stdio: 'inherit',
      shell: true,
      cwd: path.join(__dirname, '..')
    });
  } catch (e) {
    console.error('Failed to build VibeTunnel PTY addon:', e.message);
    process.exit(1);
  }
}

console.log('Native modules are ready for tests');