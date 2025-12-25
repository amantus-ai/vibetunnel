#!/usr/bin/env node

/**
 * Postinstall script for npm package
 * Handles prebuild extraction and fallback compilation
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

console.log('Setting up native modules for VibeTunnel...');

// Check for npm_config_prefix conflict with NVM
if (process.env.npm_config_prefix && process.env.NVM_DIR) {
  const nvmNodeVersion = process.execPath;
  const npmPrefix = process.env.npm_config_prefix;
  
  // Check if npm_config_prefix conflicts with NVM path
  if (!nvmNodeVersion.includes(npmPrefix) && nvmNodeVersion.includes('.nvm')) {
    console.warn('⚠️  Detected npm_config_prefix conflict with NVM');
    console.warn(`   npm_config_prefix: ${npmPrefix}`);
    console.warn(`   NVM Node path: ${nvmNodeVersion}`);
    console.warn('   This may cause npm global installs to fail or install in wrong location.');
    console.warn('   Run: unset npm_config_prefix');
    console.warn('   Then reinstall VibeTunnel for proper NVM compatibility.');
  }
}

// Check if we're in development (has src directory) or npm install
const isDevelopment = fs.existsSync(path.join(__dirname, '..', 'src'));

if (isDevelopment) {
  // In development, run the existing ensure-native-modules script
  require('./ensure-native-modules.js');
  return;
}

// For npm package, node-pty is bundled in the package root
// No need to create symlinks as it's accessed directly

// Get Node ABI version
const nodeABI = process.versions.modules;

// Get platform and architecture
const platform = process.platform;
const arch = os.arch();

// Convert architecture names
const archMap = {
  'arm64': 'arm64',
  'aarch64': 'arm64',
  'x64': 'x64',
  'x86_64': 'x64'
};
const normalizedArch = archMap[arch] || arch;

console.log(`Platform: ${platform}-${normalizedArch}, Node ABI: ${nodeABI}`);

// Function to try prebuild-install first
const tryPrebuildInstall = (moduleName, moduleDir) => {
  try {
    // Check if prebuild-install is available
    const prebuildInstallPath = require.resolve('prebuild-install/bin.js');
    console.log(`  Attempting to use prebuild-install for ${moduleName}...`);
    
    execSync(`node "${prebuildInstallPath}"`, {
      cwd: moduleDir,
      stdio: 'inherit',
      env: { ...process.env, npm_config_build_from_source: 'false' }
    });
    
    return true;
  } catch (error) {
    console.log(`  prebuild-install failed for ${moduleName}, will try manual extraction`);
    return false;
  }
};

// Function to manually extract prebuild
const extractPrebuild = (name, version, targetDir, skipDirCheck = false) => {
  const prebuildFile = path.join(__dirname, '..', 'prebuilds', 
    `${name}-v${version}-node-v${nodeABI}-${platform}-${normalizedArch}.tar.gz`);
  
  if (!fs.existsSync(prebuildFile)) {
    console.log(`  No prebuild found for ${name} on this platform`);
    return false;
  }

  // For optional dependencies like authenticate-pam, check if the module exists
  // If not, extract to a different location
  let extractDir = targetDir;
  if (skipDirCheck && name === 'authenticate-pam' && !fs.existsSync(targetDir)) {
    // Extract to a controlled location since node_modules/authenticate-pam doesn't exist
    extractDir = path.join(__dirname, '..', 'optional-modules', name);
  }

  // Create the parent directory
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    // Extract directly into the module directory - the tar already contains build/Release structure
    execSync(`tar -xzf "${prebuildFile}" -C "${extractDir}"`, { stdio: 'inherit' });
    console.log(`✓ ${name} prebuilt binary extracted`);
    return true;
  } catch (error) {
    console.error(`  Failed to extract ${name} prebuild:`, error.message);
    return false;
  }
};

// Function to compile from source
const compileFromSource = (moduleName, moduleDir) => {
  console.log(`  Building ${moduleName} from source...`);
  try {
    // First check if node-gyp is available
    try {
      execSync('node-gyp --version', { stdio: 'pipe' });
    } catch (e) {
      console.log('  Installing node-gyp...');
      execSync('npm install -g node-gyp', { stdio: 'inherit' });
    }
    
    // For node-pty, node-addon-api is included as a dependency in its package.json
    // npm should handle it automatically during source compilation
    
    execSync('node-gyp rebuild', {
      cwd: moduleDir,
      stdio: 'inherit'
    });
    console.log(`✓ ${moduleName} built successfully`);
    return true;
  } catch (error) {
    console.error(`  Failed to build ${moduleName}:`, error.message);
    return false;
  }
};

// Handle both native modules
const modules = [
  {
    name: 'node-pty',
    version: '1.0.0',
    dir: path.join(__dirname, '..', 'node-pty'),
    build: path.join(__dirname, '..', 'node-pty', 'build', 'Release', 'pty.node'),
    essential: true
  },
  {
    name: 'authenticate-pam',
    version: '1.0.5',
    dir: path.join(__dirname, '..', 'node_modules', 'authenticate-pam'),
    build: path.join(__dirname, '..', 'node_modules', 'authenticate-pam', 'build', 'Release', 'authenticate_pam.node'),
    essential: false, // Optional - falls back to other auth methods
    platforms: ['linux', 'darwin'], // Needed on Linux and macOS
    skipDirCheck: true // Don't check if dir exists since it's optional
  }
];

let hasErrors = false;

for (const module of modules) {
  console.log(`\nProcessing ${module.name}...`);
  
  // Skip platform-specific modules if not on that platform
  if (module.platforms && !module.platforms.includes(platform)) {
    console.log(`  Skipping ${module.name} (not needed on ${platform})`);
    continue;
  }

  // Check if module directory exists
  if (!fs.existsSync(module.dir)) {
    if (module.skipDirCheck) {
      // For optional modules, we'll try to extract the prebuild anyway
      console.log(`  ${module.name} not installed via npm (optional dependency), will extract prebuild`);
    } else {
      console.warn(`  Warning: ${module.name} directory not found at ${module.dir}`);
      if (module.essential) {
        hasErrors = true;
      }
      continue;
    }
  }

  // Check if already built
  // For optional modules, also check the alternative location
  let buildPath = module.build;
  if (module.skipDirCheck && module.name === 'authenticate-pam' && !fs.existsSync(module.dir)) {
    // Check the optional-modules location instead
    buildPath = path.join(__dirname, '..', 'optional-modules', module.name, 'build', 'Release', 'authenticate_pam.node');
  }
  
  if (fs.existsSync(buildPath)) {
    console.log(`✓ ${module.name} already available`);
    continue;
  }

  // Try installation methods in order
  let success = false;

  // Method 1: Try prebuild-install (preferred) - skip if directory doesn't exist
  if (fs.existsSync(module.dir)) {
    success = tryPrebuildInstall(module.name, module.dir);
  }

  // Method 2: Manual prebuild extraction
  if (!success) {
    success = extractPrebuild(module.name, module.version, module.dir, module.skipDirCheck);
  }

  // Method 3: Compile from source (skip if directory doesn't exist)
  if (!success && fs.existsSync(module.dir) && fs.existsSync(path.join(module.dir, 'binding.gyp'))) {
    success = compileFromSource(module.name, module.dir);
  }

  // Check final result
  if (!success) {
    // Special handling for authenticate-pam on macOS
    if (module.name === 'authenticate-pam' && process.platform === 'darwin') {
      console.warn(`⚠️  Warning: ${module.name} installation failed on macOS.`);
      console.warn('   This is expected - macOS will fall back to environment variable or SSH key authentication.');
      console.warn('   To enable PAM authentication, install Xcode Command Line Tools and rebuild.');
    } else if (module.essential) {
      console.error(`\n❌ ${module.name} is required for VibeTunnel to function.`);
      console.error('You may need to install build tools for your platform:');
      console.error('- macOS: Install Xcode Command Line Tools');
      console.error('- Linux: Install build-essential and libpam0g-dev packages');
      hasErrors = true;
    } else {
      console.warn(`⚠️  Warning: ${module.name} installation failed. Some features may be limited.`);
    }
  }
}

// Ensure zig forwarder is executable if present
const forwarderPath = path.join(__dirname, '..', 'bin', 'vibetunnel-fwd');
if (fs.existsSync(forwarderPath)) {
  try {
    fs.chmodSync(forwarderPath, 0o755);
    console.log('✓ Zig forwarder is executable');
  } catch (error) {
    console.warn(`⚠️  Failed to set executable bit on vibetunnel-fwd: ${error.message}`);
  }
}

// Import vt installation functions
const { detectGlobalInstall, installVtCommand } = require('./install-vt-command');

// Install vt symlink/wrapper
if (!hasErrors && !isDevelopment) {
  console.log('\nSetting up vt command...');
  
  const vtSource = path.join(__dirname, '..', 'bin', 'vt');
  
  // Use the improved global install detection
  const isGlobalInstall = detectGlobalInstall();
  console.log(`  Detected ${isGlobalInstall ? 'global' : 'local'} installation`);
  installVtCommand(vtSource, isGlobalInstall);
}

if (hasErrors) {
  console.error('\n❌ Setup failed with errors');
  process.exit(1);
} else {
  console.log('\n✅ VibeTunnel is ready to use');
  console.log('Run "vibetunnel --help" for usage information');
}
