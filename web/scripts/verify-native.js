#!/usr/bin/env node

/**
 * Verify that the native executable works correctly
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const nativeExe = path.join(__dirname, '..', 'native', 'vibetunnel');

console.log('Verifying native executable...');
console.log(`Path: ${nativeExe}`);
console.log(`Platform: ${process.platform}, Architecture: ${process.arch}`);

// Check if executable exists
if (!fs.existsSync(nativeExe)) {
  console.error('ERROR: Native executable not found!');
  process.exit(1);
}

// Check if it's executable
try {
  fs.accessSync(nativeExe, fs.constants.X_OK);
  console.log('✓ File is executable');
} catch (error) {
  console.error('ERROR: File is not executable!');
  console.log('Attempting to make it executable...');
  fs.chmodSync(nativeExe, 0o755);
}

// Check file stats
const stats = fs.statSync(nativeExe);
console.log(`Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
console.log(`Mode: ${(stats.mode & parseInt('777', 8)).toString(8)}`);

// Check if required native modules exist
console.log('\nChecking required native modules...');
const requiredModules = ['pty.node', 'authenticate_pam.node'];
if (process.platform === 'darwin') {
  requiredModules.push('spawn-helper');
}

let modulesOk = true;
for (const module of requiredModules) {
  const modulePath = path.join(__dirname, '..', 'native', module);
  if (fs.existsSync(modulePath)) {
    const moduleStats = fs.statSync(modulePath);
    console.log(`✓ ${module} (${(moduleStats.size / 1024).toFixed(1)} KB)`);
  } else {
    console.error(`✗ ${module} - NOT FOUND`);
    modulesOk = false;
  }
}

if (!modulesOk) {
  console.error('\nERROR: Required native modules are missing!');
  process.exit(1);
}

// Skip version test on Linux due to Node.js SEA segfault issues
// This affects both x64 and ARM64 architectures on Linux
// See: https://github.com/nodejs/node/issues/54491 and related issues
if (process.platform === 'linux') {
  console.log('\n⚠️  Skipping --version test on Linux due to known Node.js SEA issues');
  console.log(`Platform: ${process.platform}, Architecture: ${process.arch}`);
  console.log('The executable has been built but runtime verification is skipped.');
  console.log('This is a known issue with Node.js SEA on Linux that causes segfaults.');
  console.log('\nNative executable verification complete!');
  process.exit(0);
}

// Test running with --version
console.log('\nTesting --version flag...');
const versionTest = spawn(nativeExe, ['--version'], {
  stdio: 'pipe',
  env: { ...process.env, NODE_ENV: 'test' }
});

let versionOutput = '';
let versionError = '';

versionTest.stdout.on('data', (data) => {
  versionOutput += data.toString();
});

versionTest.stderr.on('data', (data) => {
  versionError += data.toString();
});

versionTest.on('error', (error) => {
  console.error('ERROR: Failed to spawn process:', error.message);
  process.exit(1);
});

versionTest.on('exit', (code, signal) => {
  if (code !== 0) {
    console.error(`ERROR: Process exited with code ${code}, signal ${signal}`);
    if (versionError) {
      console.error('stderr:', versionError);
    }
    if (versionOutput) {
      console.log('stdout:', versionOutput);
    }
    
    // Try to get more info with ldd/otool
    if (process.platform === 'linux') {
      console.log('\nChecking dependencies with ldd:');
      try {
        const lddOutput = require('child_process').execSync(`ldd ${nativeExe}`, { encoding: 'utf8' });
        console.log(lddOutput);
      } catch (e) {
        console.error('Failed to run ldd:', e.message);
      }
    } else if (process.platform === 'darwin') {
      console.log('\nChecking dependencies with otool:');
      try {
        const otoolOutput = require('child_process').execSync(`otool -L ${nativeExe}`, { encoding: 'utf8' });
        console.log(otoolOutput);
      } catch (e) {
        console.error('Failed to run otool:', e.message);
      }
    }
    
    process.exit(1);
  } else {
    console.log('✓ Version test passed');
    if (versionOutput) {
      console.log('Version:', versionOutput.trim());
    }
  }
});

console.log('\nNative executable verification complete!');