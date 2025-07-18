#!/usr/bin/env node
/**
 * Test script for vt installation functionality
 * This tests the install-vt-command module without relying on command substitution
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
let { execSync } = require('child_process');

// Import the module we're testing
const { detectGlobalInstall, installVtCommand } = require('./install-vt-command');

// Create a test directory
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-install-test-'));
const testBinDir = path.join(testDir, 'bin');
const vtPath = path.join(testBinDir, 'vt');

// Create test vt script
fs.mkdirSync(testBinDir, { recursive: true });
fs.writeFileSync(vtPath, '#!/bin/bash\necho "test vt script"', { mode: 0o755 });

console.log('Running vt installation tests...\n');

// Test 1: Local installation
console.log('Test 1: Local installation');
process.env.npm_config_global = 'false';
const localResult = installVtCommand(vtPath, false);
console.log(`  Result: ${localResult ? 'PASS' : 'FAIL'}`);
console.log(`  Expected: vt configured for local use\n`);

// Test 2: Global installation detection
console.log('Test 2: Global installation detection');
process.env.npm_config_global = 'true';
const isGlobal = detectGlobalInstall();
console.log(`  Detected as global: ${isGlobal}`);
console.log(`  Result: ${isGlobal === true ? 'PASS' : 'FAIL'}\n`);

// Test 3: Global installation with existing vt
console.log('Test 3: Global installation with existing vt');
// Mock the existence check
const originalExistsSync = fs.existsSync;
const originalSymlinkSync = fs.symlinkSync;
let existsCheckCalled = false;
let symlinkCalled = false;

fs.existsSync = (path) => {
  if (path.endsWith('/vt')) {
    existsCheckCalled = true;
    return true; // Simulate existing vt
  }
  return originalExistsSync(path);
};

fs.symlinkSync = (target, path) => {
  symlinkCalled = true;
  return originalSymlinkSync(target, path);
};

// Create a mock npm bin directory
const mockNpmBinDir = path.join(testDir, 'npm-bin');
fs.mkdirSync(mockNpmBinDir, { recursive: true });

// Mock execSync to return our test directory
const originalExecSync = require('child_process').execSync;
require('child_process').execSync = (cmd, opts) => {
  if (cmd.includes('npm config get prefix')) {
    return testDir;
  }
  return originalExecSync(cmd, opts);
};

process.env.npm_config_global = 'true';
const globalResult = installVtCommand(vtPath, true);
console.log(`  Existing vt check called: ${existsCheckCalled}`);
console.log(`  Symlink attempted: ${symlinkCalled}`);
console.log(`  Result: ${globalResult && existsCheckCalled && !symlinkCalled ? 'PASS' : 'FAIL'}`);
console.log(`  Expected: Should detect existing vt and skip installation\n`);

// Restore original functions
fs.existsSync = originalExistsSync;
fs.symlinkSync = originalSymlinkSync;
require('child_process').execSync = originalExecSync;

// Test 4: Missing vt script
console.log('Test 4: Missing vt script');
const missingResult = installVtCommand(path.join(testDir, 'nonexistent'), false);
console.log(`  Result: ${!missingResult ? 'PASS' : 'FAIL'}`);
console.log(`  Expected: Should return false for missing script\n`);

// Cleanup
fs.rmSync(testDir, { recursive: true, force: true });

console.log('All tests completed.');