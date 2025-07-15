#!/usr/bin/env node

/**
 * Postinstall script for npm package
 * Extracts prebuilds for the current platform
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

// Create node_modules directory if it doesn't exist
const nodeModulesDir = path.join(__dirname, '..', 'node_modules');
if (!fs.existsSync(nodeModulesDir)) {
  fs.mkdirSync(nodeModulesDir, { recursive: true });
}

// Create symlink for node-pty so it can be required normally
const nodePtySource = path.join(__dirname, '..', 'node-pty');
const nodePtyTarget = path.join(nodeModulesDir, 'node-pty');
if (!fs.existsSync(nodePtyTarget) && fs.existsSync(nodePtySource)) {
  try {
    fs.symlinkSync(nodePtySource, nodePtyTarget, 'dir');
    console.log('✓ Created node-pty symlink in node_modules');
  } catch (error) {
    console.warn('Warning: Could not create node-pty symlink:', error.message);
  }
}

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

// Function to extract prebuild
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
    essential: false,
    platforms: ['linux'] // Only needed on Linux
  }
];

let hasErrors = false;

for (const module of modules) {
  // Skip platform-specific modules if not on that platform
  if (module.platforms && !module.platforms.includes(platform)) {
    console.log(`  Skipping ${module.name} (not needed on ${platform})`);
    continue;
  }

  if (!fs.existsSync(module.build)) {
    // Try extracting prebuild
    const prebuildSuccess = extractPrebuild(module.name, module.version, module.dir);
    
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
          console.error('- Linux: Install build-essential and libpam0g-dev packages');
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