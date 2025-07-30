#!/usr/bin/env node

/**
 * Ensures Rust PTY native modules are built and available for tests
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Ensuring Rust PTY native modules are built for tests...');

// Rust PTY implementation directory
const nativePtyDir = path.join(__dirname, '..', 'native-pty');
const platform = process.platform;
const arch = process.arch === 'x64' ? 'x64' : 'arm64';
const rustPtyNode = path.join(nativePtyDir, `vibetunnel-native-pty.${platform}-${arch}.node`);

if (!fs.existsSync(nativePtyDir)) {
  console.error('Native PTY directory not found. This branch requires the Rust PTY implementation.');
  process.exit(1);
}

console.log('Using Rust PTY implementation from native-pty directory');

// Check if the native module is built
if (!fs.existsSync(rustPtyNode)) {
  console.log(`Rust PTY native module not found at ${rustPtyNode}, building...`);
  
  try {
    // Build the Rust PTY module
    execSync('make build', {
      cwd: nativePtyDir,
      stdio: 'inherit'
    });
  } catch (e) {
    console.error('Failed to build Rust PTY module:', e.message);
    process.exit(1);
  }
}

console.log('Rust PTY native module is ready for tests');