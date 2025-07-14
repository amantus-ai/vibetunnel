#!/usr/bin/env node

/**
 * Postinstall script for npm package
 * Ensures node-pty native module is properly built
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Setting up VibeTunnel CLI...');

// Check if we're in development (has src directory) or npm install
const isDevelopment = fs.existsSync(path.join(__dirname, '..', 'src'));

if (isDevelopment) {
  // In development, run the existing ensure-native-modules script
  require('./ensure-native-modules.js');
  return;
}

// In npm package installation, just verify node-pty is built
const nodePtyBuild = path.join(__dirname, '..', 'node-pty', 'build', 'Release', 'pty.node');
if (!fs.existsSync(nodePtyBuild)) {
  console.log('Building node-pty native module...');
  try {
    const nodePtyDir = path.join(__dirname, '..', 'node-pty');
    execSync('node-gyp rebuild', {
      cwd: nodePtyDir,
      stdio: 'inherit'
    });
  } catch (error) {
    console.error('Failed to build node-pty:', error.message);
    console.error('You may need to install build tools for your platform.');
    process.exit(1);
  }
}

console.log('✓ VibeTunnel CLI is ready to use');
console.log('Run "vibetunnel fwd --help" for usage information');