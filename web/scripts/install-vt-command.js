#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Helper function to detect global installation
const detectGlobalInstall = () => {
  if (process.env.npm_config_global === 'true') return true;
  if (process.env.npm_config_global === 'false') return false;
  
  try {
    const globalPrefix = execSync('npm config get prefix', { encoding: 'utf8' }).trim();
    const globalModules = path.join(globalPrefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules');
    const packagePath = path.resolve(__dirname, '..');
    return packagePath.startsWith(globalModules);
  } catch {
    return false; // Default to local install
  }
};

// Helper function to get npm global bin directory
const getNpmBinDir = () => {
  try {
    // Try npm config first (more reliable)
    const npmPrefix = execSync('npm config get prefix', { encoding: 'utf8' }).trim();
    return path.join(npmPrefix, 'bin');
  } catch (e) {
    console.warn('⚠️  Could not determine npm global bin directory');
    return null;
  }
};

// Helper function to install vt globally
const installGlobalVt = (vtSource, npmBinDir) => {
  const vtTarget = path.join(npmBinDir, 'vt');
  const isWindows = process.platform === 'win32';
  
  // Check if vt already exists
  if (fs.existsSync(vtTarget) || (isWindows && fs.existsSync(vtTarget + '.cmd'))) {
    console.log('⚠️  A "vt" command already exists in your system');
    console.log('   VibeTunnel\'s vt wrapper was not installed to avoid conflicts');
    console.log('   You can still use "npx vt" or the full path to run VibeTunnel\'s vt');
    return true;
  }
  
  try {
    if (isWindows) {
      // On Windows, create a .cmd wrapper
      const cmdContent = `@echo off\r\nnode "%~dp0\\vt" %*\r\n`;
      fs.writeFileSync(vtTarget + '.cmd', cmdContent);
      // Also copy the actual script
      fs.copyFileSync(vtSource, vtTarget);
      console.log('✓ vt command installed globally (Windows)');
    } else {
      // On Unix-like systems, create symlink
      fs.symlinkSync(vtSource, vtTarget);
      console.log('✓ vt command installed globally');
    }
    console.log('  You can now use "vt" to wrap commands with VibeTunnel');
    return true;
  } catch (symlinkError) {
    // If symlink fails on Unix, try copying the file
    if (!isWindows) {
      try {
        fs.copyFileSync(vtSource, vtTarget);
        fs.chmodSync(vtTarget, '755');
        console.log('✓ vt command installed globally (copied)');
        console.log('  You can now use "vt" to wrap commands with VibeTunnel');
        return true;
      } catch (copyError) {
        console.warn('⚠️  Could not install vt command globally:', copyError.message);
        console.log('   Use "npx vt" or "vibetunnel fwd" instead');
        return false;
      }
    } else {
      console.warn('⚠️  Could not install vt command on Windows:', symlinkError.message);
      console.log('   Use "npx vt" or "vibetunnel fwd" instead');
      return false;
    }
  }
};

// Install vt command handler
const installVtCommand = (vtSource, isGlobalInstall) => {
  if (!fs.existsSync(vtSource)) {
    console.warn('⚠️  vt command script not found in package');
    console.log('   Use "vibetunnel" command instead');
    return false;
  }
  
  try {
    // Make vt script executable (Unix-like systems only)
    if (process.platform !== 'win32') {
      fs.chmodSync(vtSource, '755');
    }
    
    if (!isGlobalInstall) {
      console.log('✓ vt command configured for local use');
      console.log('  Use "npx vt" to run the vt wrapper');
      return true;
    }
    
    const npmBinDir = getNpmBinDir();
    if (!npmBinDir) {
      return false;
    }
    
    return installGlobalVt(vtSource, npmBinDir);
  } catch (error) {
    console.warn('⚠️  Could not configure vt command:', error.message);
    console.log('   Use "vibetunnel" command instead');
    return false;
  }
};

module.exports = {
  detectGlobalInstall,
  getNpmBinDir,
  installGlobalVt,
  installVtCommand
};