#!/usr/bin/env node

/**
 * Ensures native modules are built and available for tests
 * This script handles pnpm's symlink structure where node-pty might be in .pnpm directory
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Ensuring native modules are built for tests...');

// Find the actual node-pty location (could be in .pnpm directory)
let nodePtyPath;
try {
  nodePtyPath = require.resolve('node-pty/package.json');
} catch (e) {
  console.error('Could not find node-pty module');
  process.exit(1);
}

const nodePtyDir = path.dirname(nodePtyPath);
const buildDir = path.join(nodePtyDir, 'build');
const releaseDir = path.join(buildDir, 'Release');

console.log(`Found node-pty at: ${nodePtyDir}`);

// Check if native modules are built
if (!fs.existsSync(releaseDir) || !fs.existsSync(path.join(releaseDir, 'pty.node'))) {
  console.log('Native modules not found, building...');
  
  try {
    // Build using node-gyp directly to avoid TypeScript issues
    execSync(`cd "${nodePtyDir}" && npx node-gyp rebuild`, {
      stdio: 'inherit',
      shell: true
    });
  } catch (e) {
    console.error('Failed to build native modules:', e.message);
    process.exit(1);
  }
}

// For pnpm, ensure the symlinked node_modules/node-pty has the build directory
const symlinkNodePty = path.join(__dirname, '../node_modules/node-pty');
if (fs.existsSync(symlinkNodePty) && fs.lstatSync(symlinkNodePty).isSymbolicLink()) {
  const symlinkBuildDir = path.join(symlinkNodePty, 'build');
  
  // If the symlinked location doesn't have a build directory, create a symlink to the real one
  if (!fs.existsSync(symlinkBuildDir) && fs.existsSync(buildDir)) {
    console.log('Creating symlink for build directory in node_modules/node-pty...');
    try {
      const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
      fs.symlinkSync(buildDir, symlinkBuildDir, symlinkType);
      console.log('Created build directory symlink');
    } catch (e) {
      // If symlink fails, try copying instead
      console.log('Symlink failed, trying to copy build directory...');
      fs.cpSync(buildDir, symlinkBuildDir, { recursive: true });
      console.log('Copied build directory');
    }
  }
}

console.log('Native modules are ready for tests');

// Ensure zig forwarder exists (required now that Node forwarder is removed)
const webRoot = path.join(__dirname, '..');
const nativeForwarderPath = path.join(webRoot, 'native', 'vibetunnel-fwd');
const binForwarderPath = path.join(webRoot, 'bin', 'vibetunnel-fwd');

if (!fs.existsSync(nativeForwarderPath) || !fs.existsSync(binForwarderPath)) {
  console.log('zig forwarder not found, building...');

  try {
    execSync('zig version', { stdio: 'ignore' });
  } catch (_e) {
    console.error('zig is required to build vibetunnel-fwd but was not found in PATH');
    console.error('Install zig, then run: node scripts/build-fwd-zig.js');
    process.exit(1);
  }

  try {
    execSync('node scripts/build-fwd-zig.js', {
      cwd: webRoot,
      stdio: 'inherit',
      shell: true,
    });
  } catch (e) {
    console.error('Failed to build zig forwarder:', e.message);
    process.exit(1);
  }
}
