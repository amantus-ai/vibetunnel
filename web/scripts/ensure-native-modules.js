#!/usr/bin/env node

/**
 * Ensures native modules are built and available for tests
 * This script handles the native PTY addon built with napi-rs
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Ensuring native modules are built for tests...');

// Check if native-pty addon is built
const nativePtyPath = path.join(__dirname, '../native-pty/index.node');

if (!fs.existsSync(nativePtyPath)) {
  console.log('Native PTY addon not found, building...');
  
  try {
    // Install dependencies first
    execSync('cd native-pty && npm install', {
      stdio: 'inherit',
      shell: true,
      cwd: path.join(__dirname, '..')
    });
    
    // Build the native addon
    execSync('cd native-pty && npm run build', {
      stdio: 'inherit',
      shell: true,
      cwd: path.join(__dirname, '..')
    });
  } catch (e) {
    console.error('Failed to build native PTY addon:', e.message);
    process.exit(1);
  }
}

// Also check the old vibetunnel-pty for compatibility
const vibetunnelPtyPath = path.join(__dirname, '../vibetunnel-pty/index.node');
if (!fs.existsSync(vibetunnelPtyPath)) {
  console.log('VibeTunnel PTY addon (legacy) not found, building...');
  
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
    console.error('Failed to build VibeTunnel PTY addon (legacy):', e.message);
    // Don't exit, this is optional
  }
}

console.log('Native modules are ready for tests');