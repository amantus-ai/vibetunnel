#!/usr/bin/env node

/**
 * Postinstall script for npm package
 * Fallback build script when prebuild-install fails
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Setting up native modules for VibeTunnel...');

// Check if we're in development (has src directory) or npm install
const isDevelopment = fs.existsSync(path.join(__dirname, '..', 'src'));

if (isDevelopment) {
  // In development, run the existing ensure-native-modules script
  require('./ensure-native-modules.js');
  return;
}

// Try prebuild-install first for each module
const tryPrebuildInstall = (name, dir) => {
  console.log(`Trying prebuild-install for ${name}...`);
  try {
    execSync('prebuild-install', {
      cwd: dir,
      stdio: 'inherit',
      env: { ...process.env, npm_config_cache: path.join(require('os').homedir(), '.npm') }
    });
    console.log(`✓ ${name} prebuilt binary installed`);
    return true;
  } catch (error) {
    console.log(`  No prebuilt binary available for ${name}, will compile from source`);
    return false;
  }
};

// Handle both native modules with prebuild-install fallback
const modules = [
  {
    name: 'node-pty',
    dir: path.join(__dirname, '..', 'node-pty'),
    build: path.join(__dirname, '..', 'node-pty', 'build', 'Release', 'pty.node'),
    essential: true
  },
  {
    name: 'authenticate-pam',
    dir: path.join(__dirname, '..', 'node_modules', 'authenticate-pam'),
    build: path.join(__dirname, '..', 'node_modules', 'authenticate-pam', 'build', 'Release', 'authenticate_pam.node'),
    essential: false
  }
];

let hasErrors = false;

for (const module of modules) {
  if (!fs.existsSync(module.build)) {
    // First try prebuild-install
    const prebuildSuccess = tryPrebuildInstall(module.name, module.dir);
    
    if (!prebuildSuccess) {
      // Fall back to compilation
      console.log(`Building ${module.name} from source...`);
      try {
        execSync('node-gyp rebuild', {
          cwd: module.dir,
          stdio: 'inherit'
        });
        console.log(`✓ ${module.name} built successfully`);
      } catch (error) {
        console.error(`Failed to build ${module.name}:`, error.message);
        if (module.essential) {
          console.error(`${module.name} is required for VibeTunnel to function.`);
          console.error('You may need to install build tools for your platform:');
          console.error('- macOS: Install Xcode Command Line Tools');
          console.error('- Linux: Install build-essential package');
          hasErrors = true;
        } else {
          console.warn(`Warning: ${module.name} build failed. Some features may be limited.`);
        }
      }
    }
  } else {
    console.log(`✓ ${module.name} already available`);
  }
}

if (hasErrors) {
  process.exit(1);
}

// Conditionally install vt symlink
if (!isDevelopment) {
  try {
    // Find npm's global bin directory
    const npmBinDir = execSync('npm bin -g', { encoding: 'utf8' }).trim();
    const vtTarget = path.join(npmBinDir, 'vt');
    const vtSource = path.join(__dirname, '..', 'bin', 'vt');
    
    // Check if vt already exists
    if (fs.existsSync(vtTarget)) {
      // Check if it's already our symlink
      try {
        const stats = fs.lstatSync(vtTarget);
        if (stats.isSymbolicLink()) {
          const linkTarget = fs.readlinkSync(vtTarget);
          if (linkTarget.includes('vibetunnel')) {
            console.log('✓ vt command already installed (VibeTunnel)');
          } else {
            console.log('⚠️  vt command already exists (different tool)');
            console.log('   Use "vibetunnel" command or "npx vt" instead');
          }
        } else {
          console.log('⚠️  vt command already exists (not a symlink)');
          console.log('   Use "vibetunnel" command instead');
        }
      } catch (e) {
        // Ignore errors checking the existing file
        console.log('⚠️  vt command already exists');
        console.log('   Use "vibetunnel" command instead');
      }
    } else {
      // Create the symlink
      try {
        fs.symlinkSync(vtSource, vtTarget);
        // Make it executable
        fs.chmodSync(vtTarget, '755');
        console.log('✓ vt command installed successfully');
      } catch (error) {
        console.warn('⚠️  Could not install vt command:', error.message);
        console.log('   Use "vibetunnel" command instead');
      }
    }
  } catch (error) {
    // If we can't determine npm bin dir or create symlink, just warn
    console.warn('⚠️  Could not install vt command:', error.message);
    console.log('   Use "vibetunnel" command instead');
  }
}

console.log('✓ VibeTunnel is ready to use');
console.log('Run "vibetunnel --help" for usage information');