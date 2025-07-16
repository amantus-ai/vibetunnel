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
const extractPrebuild = (name, version, targetDir) => {
  const prebuildFile = path.join(__dirname, '..', 'prebuilds', 
    `${name}-v${version}-node-v${nodeABI}-${platform}-${normalizedArch}.tar.gz`);
  
  if (!fs.existsSync(prebuildFile)) {
    console.log(`  No prebuild found for ${name} on this platform`);
    return false;
  }

  // Create the parent directory
  const buildParentDir = path.join(targetDir);
  fs.mkdirSync(buildParentDir, { recursive: true });

  try {
    // Extract directly into the module directory - the tar already contains build/Release structure
    execSync(`tar -xzf "${prebuildFile}" -C "${buildParentDir}"`, { stdio: 'inherit' });
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
    platforms: ['linux', 'darwin'] // Needed on Linux and macOS
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
    console.warn(`  Warning: ${module.name} directory not found at ${module.dir}`);
    if (module.essential) {
      hasErrors = true;
    }
    continue;
  }

  // Check if already built
  if (fs.existsSync(module.build)) {
    console.log(`✓ ${module.name} already available`);
    continue;
  }

  // Try installation methods in order
  let success = false;

  // Method 1: Try prebuild-install (preferred)
  success = tryPrebuildInstall(module.name, module.dir);

  // Method 2: Manual prebuild extraction
  if (!success) {
    success = extractPrebuild(module.name, module.version, module.dir);
  }

  // Method 3: Compile from source
  if (!success && fs.existsSync(path.join(module.dir, 'binding.gyp'))) {
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

// Install vt symlink/wrapper
if (!hasErrors && !isDevelopment) {
  console.log('\nSetting up vt command...');
  
  const vtSource = path.join(__dirname, '..', 'bin', 'vt');
  
  // Check if vt script exists
  if (!fs.existsSync(vtSource)) {
    console.warn('⚠️  vt command script not found in package');
    console.log('   Use "vibetunnel" command instead');
  } else {
    try {
      // Make vt script executable
      fs.chmodSync(vtSource, '755');
      console.log('✓ vt command configured');
      console.log('  Note: The vt command is available through npm/npx');
    } catch (error) {
      console.warn('⚠️  Could not configure vt command:', error.message);
      console.log('   Use "vibetunnel" command instead');
    }
  }
}

if (hasErrors) {
  console.error('\n❌ Setup failed with errors');
  process.exit(1);
} else {
  console.log('\n✅ VibeTunnel is ready to use');
  console.log('Run "vibetunnel --help" for usage information');
}