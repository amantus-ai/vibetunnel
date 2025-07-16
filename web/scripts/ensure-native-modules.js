#!/usr/bin/env node

/**
 * Ensures native modules are built and available for tests
 * This script handles the native PTY addon built with napi-rs
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Ensuring native modules are built...');

<<<<<<< HEAD
// Legacy vibetunnel-pty is no longer needed - removed to prevent CI failures
||||||| parent of af39b343 (fix: add Rust setup to Playwright CI and fix Linux platform detection)
// Check if vibetunnel-pty addon is built
const vibetunnelPtyPath = path.join(__dirname, '../vibetunnel-pty');
const vibetunnelPtyNode = path.join(vibetunnelPtyPath, `vibetunnel-pty.${process.platform}-${process.arch}.node`);

if (!fs.existsSync(vibetunnelPtyNode)) {
  console.log('VibeTunnel PTY addon not found, building...');
  
  try {
    // Install dependencies first
    execSync('cd vibetunnel-pty && npm install', {
      stdio: 'inherit',
      shell: true,
      cwd: path.join(__dirname, '..')
    });
    
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
=======
// Check if vibetunnel-pty addon is built
const vibetunnelPtyPath = path.join(__dirname, '../vibetunnel-pty');

// Determine the correct platform-specific filename
let platformSuffix = `${process.platform}-${process.arch}`;
if (process.platform === 'linux') {
  // Linux builds have additional -gnu or -musl suffix
  // For now, assume glibc (gnu) systems which is most common
  platformSuffix = `${process.platform}-${process.arch}-gnu`;
}
const vibetunnelPtyNode = path.join(vibetunnelPtyPath, `vibetunnel-pty.${platformSuffix}.node`);

if (!fs.existsSync(vibetunnelPtyNode)) {
  console.log('VibeTunnel PTY addon not found, building...');
  
  try {
    // Install dependencies first
    execSync('cd vibetunnel-pty && npm install', {
      stdio: 'inherit',
      shell: true,
      cwd: path.join(__dirname, '..')
    });
    
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
>>>>>>> af39b343 (fix: add Rust setup to Playwright CI and fix Linux platform detection)

console.log('Native modules are ready for tests');