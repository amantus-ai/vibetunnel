#!/usr/bin/env node

/**
 * Clean npm build script for VibeTunnel
 * Uses a separate dist-npm directory with its own package.json
 * Builds for all platforms by default with complete prebuild support
 * 
 * Options:
 *   --current-only    Build for current platform/arch only (legacy mode)
 *   --no-docker      Skip Docker builds (Linux builds will be skipped)
 *   --platform <os>  Build for specific platform (darwin, linux)
 *   --arch <arch>    Build for specific architecture (x64, arm64)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const NODE_VERSIONS = ['20', '22', '23', '24'];
const ALL_PLATFORMS = {
  darwin: ['x64', 'arm64'],
  linux: ['x64', 'arm64']
};

const DIST_DIR = path.join(__dirname, '..', 'dist-npm');
const ROOT_DIR = path.join(__dirname, '..');

// Map Node.js versions to ABI versions
// ABI versions from: https://nodejs.org/api/n-api.html#node-api-version-matrix
// These map to the internal V8 ABI versions used by prebuild
function getNodeAbi(nodeVersion) {
  const abiMap = {
    '20': '115', // Node.js 20.x uses ABI 115
    '22': '127', // Node.js 22.x uses ABI 127
    '23': '131', // Node.js 23.x uses ABI 131
    '24': '134'  // Node.js 24.x uses ABI 134
  };
  return abiMap[nodeVersion];
}

// Parse command line arguments
const args = process.argv.slice(2);
const currentOnly = args.includes('--current-only');
const noDocker = args.includes('--no-docker');
const platformFilter = args.find(arg => arg.startsWith('--platform'))?.split('=')[1] || 
                      (args.includes('--platform') ? args[args.indexOf('--platform') + 1] : null);
const archFilter = args.find(arg => arg.startsWith('--arch'))?.split('=')[1] || 
                  (args.includes('--arch') ? args[args.indexOf('--arch') + 1] : null);

// Validate platform and architecture arguments
const VALID_PLATFORMS = ['darwin', 'linux'];
const VALID_ARCHS = ['x64', 'arm64'];

if (platformFilter && !VALID_PLATFORMS.includes(platformFilter)) {
  console.error(`❌ Invalid platform: ${platformFilter}. Valid options: ${VALID_PLATFORMS.join(', ')}`);
  process.exit(1);
}

if (archFilter && !VALID_ARCHS.includes(archFilter)) {
  console.error(`❌ Invalid arch: ${archFilter}. Valid options: ${VALID_ARCHS.join(', ')}`);
  process.exit(1);
}

let PLATFORMS = ALL_PLATFORMS;

if (currentOnly) {
  // Legacy mode: current platform/arch only
  PLATFORMS = { [process.platform]: [process.arch] };
} else {
  // Apply filters
  if (platformFilter) {
    PLATFORMS = { [platformFilter]: ALL_PLATFORMS[platformFilter] || [] };
  }
  if (archFilter) {
    PLATFORMS = Object.fromEntries(
      Object.entries(PLATFORMS).map(([platform, archs]) => [
        platform, 
        archs.filter(arch => arch === archFilter)
      ])
    );
  }
}

console.log('🚀 Building VibeTunnel for npm distribution (clean approach)...\n');

if (currentOnly) {
  console.log(`📦 Legacy mode: Building for ${process.platform}/${process.arch} only\n`);
} else {
  console.log('🌐 Multi-platform mode: Building for all supported platforms\n');
  console.log('Target platforms:', Object.entries(PLATFORMS)
    .map(([platform, archs]) => `${platform}(${archs.join(',')})`)
    .join(', '));
  console.log('');
}

// Check if Docker is available for Linux builds
function checkDocker() {
  try {
    execSync('docker --version', { stdio: 'pipe' });
    return true;
  } catch (e) {
    if (PLATFORMS.linux && !noDocker) {
      console.error('❌ Docker is required for Linux builds but is not installed.');
      console.error('Please install Docker using one of these options:');
      console.error('  - OrbStack (recommended): https://orbstack.dev/');
      console.error('  - Docker Desktop: https://www.docker.com/products/docker-desktop/');
      console.error('  - Use --no-docker to skip Linux builds');
      process.exit(1);
    }
    return false;
  }
}

// Build for macOS locally
function buildMacOS() {
  console.log('🍎 Building macOS binaries locally...\n');
  
  // First ensure prebuild is available
  try {
    execSync('npx prebuild --version', { stdio: 'pipe' });
  } catch (e) {
    console.log('  Installing prebuild dependencies...');
    execSync('npm install', { stdio: 'inherit' });
  }
  
  // Build node-pty
  console.log('  Building node-pty...');
  const nodePtyDir = path.join(__dirname, '..', 'node-pty');
  
  for (const nodeVersion of NODE_VERSIONS) {
    for (const arch of PLATFORMS.darwin || []) {
      console.log(`    → node-pty for Node.js ${nodeVersion} ${arch}`);
      try {
        execSync(`npx prebuild --runtime node --target ${nodeVersion}.0.0 --arch ${arch}`, {
          cwd: nodePtyDir,
          stdio: 'pipe'
        });
      } catch (error) {
        console.error(`      ❌ Failed to build node-pty for Node.js ${nodeVersion} ${arch}`);
        console.error(`      Error: ${error.message}`);
        process.exit(1);
      }
    }
  }
  
  // Build universal spawn-helper binaries for macOS
  console.log('  Building universal spawn-helper binaries...');
  const spawnHelperSrc = path.join(nodePtyDir, 'src', 'unix', 'spawn-helper.cc');
  const tempDir = path.join(__dirname, '..', 'temp-spawn-helper');
  
  // Ensure temp directory exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  try {
    // Build for x64
    console.log(`    → spawn-helper for x64`);
    execSync(`clang++ -arch x86_64 -o ${tempDir}/spawn-helper-x64 ${spawnHelperSrc}`, {
      stdio: 'pipe'
    });
    
    // Build for arm64
    console.log(`    → spawn-helper for arm64`);
    execSync(`clang++ -arch arm64 -o ${tempDir}/spawn-helper-arm64 ${spawnHelperSrc}`, {
      stdio: 'pipe'
    });
    
    // Create universal binary
    console.log(`    → Creating universal spawn-helper binary`);
    execSync(`lipo -create ${tempDir}/spawn-helper-x64 ${tempDir}/spawn-helper-arm64 -output ${tempDir}/spawn-helper-universal`, {
      stdio: 'pipe'
    });
    
    // Add universal spawn-helper to each macOS prebuild
    for (const nodeVersion of NODE_VERSIONS) {
      for (const arch of PLATFORMS.darwin || []) {
        const prebuildFile = path.join(nodePtyDir, 'prebuilds', `node-pty-v1.0.0-node-v${getNodeAbi(nodeVersion)}-darwin-${arch}.tar.gz`);
        if (fs.existsSync(prebuildFile)) {
          console.log(`    → Adding spawn-helper to ${path.basename(prebuildFile)}`);
          
          // Extract existing prebuild
          const extractDir = path.join(tempDir, `extract-${nodeVersion}-${arch}`);
          if (fs.existsSync(extractDir)) {
            fs.rmSync(extractDir, { recursive: true, force: true });
          }
          fs.mkdirSync(extractDir, { recursive: true });
          
          execSync(`tar -xzf ${prebuildFile} -C ${extractDir}`, { stdio: 'pipe' });
          
          // Copy universal spawn-helper
          fs.copyFileSync(`${tempDir}/spawn-helper-universal`, `${extractDir}/build/Release/spawn-helper`);
          fs.chmodSync(`${extractDir}/build/Release/spawn-helper`, '755');
          
          // Repackage prebuild
          execSync(`tar -czf ${prebuildFile} -C ${extractDir} .`, { stdio: 'pipe' });
          
          // Clean up extract directory
          fs.rmSync(extractDir, { recursive: true, force: true });
        }
      }
    }
    
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log('    ✅ Universal spawn-helper binaries created and added to prebuilds');
    
  } catch (error) {
    console.error(`      ❌ Failed to build universal spawn-helper: ${error.message}`);
    // Clean up on error
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    process.exit(1);
  }
  
  // Build authenticate-pam
  console.log('  Building authenticate-pam...');
  const authenticatePamDir = path.join(__dirname, '..', 'node_modules', '.pnpm', 'authenticate-pam@1.0.5', 'node_modules', 'authenticate-pam');
  
  for (const nodeVersion of NODE_VERSIONS) {
    for (const arch of PLATFORMS.darwin || []) {
      console.log(`    → authenticate-pam for Node.js ${nodeVersion} ${arch}`);
      try {
        // Use inherit stdio to see any errors during build
        const result = execSync(`npx prebuild --runtime node --target ${nodeVersion}.0.0 --arch ${arch} --tag-prefix authenticate-pam-v`, {
          cwd: authenticatePamDir,
          stdio: 'pipe',
          env: { ...process.env, npm_config_target_platform: 'darwin', npm_config_target_arch: arch }
        });
        
        // Check if prebuild was actually created
        const prebuildFile = path.join(authenticatePamDir, 'prebuilds', `authenticate-pam-v1.0.5-node-v${getNodeAbi(nodeVersion)}-darwin-${arch}.tar.gz`);
        if (fs.existsSync(prebuildFile)) {
          console.log(`      ✅ Created ${path.basename(prebuildFile)}`);
        } else {
          console.warn(`      ⚠️  Prebuild file not created for Node.js ${nodeVersion} ${arch}`);
        }
      } catch (error) {
        // Don't exit on macOS authenticate-pam build failures - it might work during npm install
        console.warn(`      ⚠️  authenticate-pam build failed for macOS (this may be normal)`);
        console.warn(`      Error: ${error.message}`);
        // Continue with other builds instead of exiting
      }
    }
  }
  
  console.log('✅ macOS builds completed\n');
}

// Build for Linux using Docker
function buildLinux() {
  console.log('🐧 Building Linux binaries using Docker...\n');
  
  const dockerScript = `
    set -e
    export CI=true
    export DEBIAN_FRONTEND=noninteractive
    
    # Install dependencies including cross-compilation tools
    apt-get update -qq
    apt-get install -y -qq python3 make g++ git libpam0g-dev gcc-aarch64-linux-gnu g++-aarch64-linux-gnu
    
    # Add ARM64 architecture for cross-compilation
    dpkg --add-architecture arm64
    apt-get update -qq
    apt-get install -y -qq libpam0g-dev:arm64
    
    # Install pnpm
    npm install -g pnpm --force --no-frozen-lockfile
    
    # Install dependencies
    cd /workspace
    pnpm install --force --no-frozen-lockfile
    
    # Build node-pty for Linux
    cd /workspace/node-pty
    for node_version in ${NODE_VERSIONS.join(' ')}; do
      for arch in ${(PLATFORMS.linux || []).join(' ')}; do
        echo "Building node-pty for Node.js \$node_version \$arch"
        if [ "\$arch" = "arm64" ]; then
          export CC=aarch64-linux-gnu-gcc
          export CXX=aarch64-linux-gnu-g++
          export AR=aarch64-linux-gnu-ar
          export STRIP=aarch64-linux-gnu-strip
          export LINK=aarch64-linux-gnu-g++
        else
          unset CC CXX AR STRIP LINK
        fi
        npm_config_target_platform=linux npm_config_target_arch=\$arch \\
          npx prebuild --runtime node --target \$node_version.0.0 --arch \$arch || exit 1
      done
    done
    
    # Build authenticate-pam for Linux  
    cd /workspace/node_modules/.pnpm/authenticate-pam@1.0.5/node_modules/authenticate-pam
    for node_version in ${NODE_VERSIONS.join(' ')}; do
      for arch in ${(PLATFORMS.linux || []).join(' ')}; do
        echo "Building authenticate-pam for Node.js \$node_version \$arch"
        if [ "\$arch" = "arm64" ]; then
          export CC=aarch64-linux-gnu-gcc
          export CXX=aarch64-linux-gnu-g++
          export AR=aarch64-linux-gnu-ar
          export STRIP=aarch64-linux-gnu-strip
          export LINK=aarch64-linux-gnu-g++
        else
          unset CC CXX AR STRIP LINK
        fi
        npm_config_target_platform=linux npm_config_target_arch=\$arch \\
          npx prebuild --runtime node --target \$node_version.0.0 --arch \$arch --tag-prefix authenticate-pam-v || exit 1
      done
    done
    
    echo "Linux builds completed successfully"
  `;
  
  try {
    execSync(`docker run --rm --platform linux/amd64 -v "\${PWD}:/workspace" -w /workspace node:22-bookworm bash -c '${dockerScript}'`, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    });
    console.log('✅ Linux builds completed\n');
  } catch (error) {
    console.error('❌ Linux build failed:', error.message);
    process.exit(1);
  }
}

// Copy and merge all prebuilds
function mergePrebuilds() {
  console.log('📦 Merging prebuilds...\n');
  
  const rootPrebuildsDir = path.join(__dirname, '..', 'prebuilds');
  const nodePtyPrebuildsDir = path.join(__dirname, '..', 'node-pty', 'prebuilds');
  
  // Ensure root prebuilds directory exists
  if (!fs.existsSync(rootPrebuildsDir)) {
    fs.mkdirSync(rootPrebuildsDir, { recursive: true });
  }
  
  // Copy node-pty prebuilds
  if (fs.existsSync(nodePtyPrebuildsDir)) {
    console.log('  Copying node-pty prebuilds...');
    const nodePtyFiles = fs.readdirSync(nodePtyPrebuildsDir);
    for (const file of nodePtyFiles) {
      const srcPath = path.join(nodePtyPrebuildsDir, file);
      const destPath = path.join(rootPrebuildsDir, file);
      if (fs.statSync(srcPath).isFile()) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`    → ${file}`);
      }
    }
  }
  
  // Copy authenticate-pam prebuilds
  const authenticatePamPrebuildsDir = path.join(__dirname, '..', 'node_modules', '.pnpm', 'authenticate-pam@1.0.5', 'node_modules', 'authenticate-pam', 'prebuilds');
  if (fs.existsSync(authenticatePamPrebuildsDir)) {
    console.log('  Copying authenticate-pam prebuilds...');
    const pamFiles = fs.readdirSync(authenticatePamPrebuildsDir);
    for (const file of pamFiles) {
      const srcPath = path.join(authenticatePamPrebuildsDir, file);
      const destPath = path.join(rootPrebuildsDir, file);
      if (fs.statSync(srcPath).isFile()) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`    → ${file}`);
      }
    }
  }
  
  // Count total prebuilds
  const allPrebuilds = fs.readdirSync(rootPrebuildsDir).filter(f => f.endsWith('.tar.gz'));
  const nodePtyCount = allPrebuilds.filter(f => f.startsWith('node-pty')).length;
  const pamCount = allPrebuilds.filter(f => f.startsWith('authenticate-pam')).length;
  
  console.log(`✅ Merged prebuilds: ${nodePtyCount} node-pty + ${pamCount} authenticate-pam = ${allPrebuilds.length} total\n`);
}

// Bundle node-pty with its dependencies
function bundleNodePty() {
  console.log('📦 Bundling node-pty with dependencies...\n');
  
  const nodePtyDir = path.join(DIST_DIR, 'node-pty');
  const nodeAddonApiDest = path.join(nodePtyDir, 'node_modules', 'node-addon-api');
  
  // Try multiple strategies to find node-addon-api
  const possiblePaths = [];
  
  // Strategy 1: Direct dependency in node_modules
  const directPath = path.join(ROOT_DIR, 'node_modules', 'node-addon-api');
  if (fs.existsSync(directPath)) {
    possiblePaths.push(directPath);
  }
  
  // Strategy 2: pnpm structure (any version)
  const pnpmDir = path.join(ROOT_DIR, 'node_modules', '.pnpm');
  if (fs.existsSync(pnpmDir)) {
    const pnpmEntries = fs.readdirSync(pnpmDir)
      .filter(dir => dir.startsWith('node-addon-api@'))
      .map(dir => path.join(pnpmDir, dir, 'node_modules', 'node-addon-api'))
      .filter(fs.existsSync);
    possiblePaths.push(...pnpmEntries);
  }
  
  // Strategy 3: Check if it's a dependency of node-pty
  const nodePtyModules = path.join(ROOT_DIR, 'node-pty', 'node_modules', 'node-addon-api');
  if (fs.existsSync(nodePtyModules)) {
    possiblePaths.push(nodePtyModules);
  }
  
  // Strategy 4: Hoisted by npm/yarn (parent directory)
  const hoistedPath = path.join(ROOT_DIR, '..', 'node_modules', 'node-addon-api');
  if (fs.existsSync(hoistedPath)) {
    possiblePaths.push(hoistedPath);
  }
  
  if (possiblePaths.length > 0) {
    const nodeAddonApiSrc = possiblePaths[0];
    fs.mkdirSync(path.dirname(nodeAddonApiDest), { recursive: true });
    fs.cpSync(nodeAddonApiSrc, nodeAddonApiDest, { recursive: true });
    console.log(`  ✅ Bundled node-addon-api from: ${path.relative(ROOT_DIR, nodeAddonApiSrc)}`);
  } else {
    console.error('  ❌ CRITICAL: node-addon-api not found - source compilation will fail!');
    console.error('     Please ensure node-addon-api is installed as a dependency.');
    console.error('     Run: pnpm add -D node-addon-api');
    // Don't exit during build - let the developer decide
    console.warn('  ⚠️  Continuing build, but npm package may have issues if prebuilds are missing.');
  }
  
  console.log('✅ node-pty bundled with dependencies\n');
}

// Copy authenticate-pam module for Linux support (OUR LINUX FIX)
// Note: This was missing in beta 14 because the hardcoded pnpm path didn't match
// the actual installation structure, causing PAM authentication to be unavailable
function copyAuthenticatePam() {
  console.log('📦 Copying authenticate-pam module for Linux support...\n');
  
  // Try multiple possible locations for authenticate-pam
  const possiblePaths = [
    // Direct node_modules path (symlink target)
    path.join(ROOT_DIR, 'node_modules', 'authenticate-pam'),
    // pnpm structure with version
    path.join(ROOT_DIR, 'node_modules', '.pnpm', 'authenticate-pam@1.0.5', 'node_modules', 'authenticate-pam'),
    // pnpm structure without specific version (in case of updates)
    ...fs.existsSync(path.join(ROOT_DIR, 'node_modules', '.pnpm')) 
      ? fs.readdirSync(path.join(ROOT_DIR, 'node_modules', '.pnpm'))
          .filter(dir => dir.startsWith('authenticate-pam@'))
          .map(dir => path.join(ROOT_DIR, 'node_modules', '.pnpm', dir, 'node_modules', 'authenticate-pam'))
      : []
  ];
  
  let srcDir = null;
  for (const possiblePath of possiblePaths) {
    try {
      // Use fs.statSync to properly follow symlinks
      const stats = fs.statSync(possiblePath);
      if (stats.isDirectory()) {
        srcDir = possiblePath;
        console.log(`  Found authenticate-pam at: ${path.relative(ROOT_DIR, possiblePath)}`);
        break;
      }
    } catch (e) {
      // Path doesn't exist, continue to next
    }
  }
  
  if (!srcDir) {
    console.warn('⚠️  authenticate-pam source not found, Linux PAM auth may not work');
    console.warn('    Searched in:');
    possiblePaths.forEach(p => console.warn(`      - ${path.relative(ROOT_DIR, p)}`));
    return;
  }
  
  const destDir = path.join(DIST_DIR, 'node_modules', 'authenticate-pam');
  
  // Create destination directory structure
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  
  // Copy entire module
  fs.cpSync(srcDir, destDir, { recursive: true });
  console.log('✅ authenticate-pam module copied to dist-npm for Linux PAM auth\n');
}

// Enhanced validation (OUR IMPROVEMENT)
function validatePackageHybrid() {
  console.log('🔍 Validating hybrid package completeness...\n');
  
  const errors = [];
  const warnings = [];
  
  // Check critical files in dist-npm
  const criticalFiles = [
    'lib/vibetunnel-cli',
    'lib/cli.js',
    'bin/vibetunnel',
    'bin/vibetunnel-fwd',
    'bin/vt',
    'scripts/postinstall.js',
    'public/index.html',
    'node-pty/package.json',
    'node-pty/binding.gyp',
    'package.json'
  ];
  
  for (const file of criticalFiles) {
    const fullPath = path.join(DIST_DIR, file);
    if (!fs.existsSync(fullPath)) {
      errors.push(`Missing critical file: ${file}`);
    }
  }
  
  // Check prebuilds (only required when not in current-only mode)
  const prebuildsDir = path.join(DIST_DIR, 'prebuilds');
  if (!currentOnly) {
    if (!fs.existsSync(prebuildsDir)) {
      errors.push('Missing prebuilds directory in dist-npm');
    } else {
      const prebuilds = fs.readdirSync(prebuildsDir).filter(f => f.endsWith('.tar.gz'));
      if (prebuilds.length === 0) {
        warnings.push('No prebuilds found in dist-npm prebuilds directory');
      } else {
        console.log(`  Found ${prebuilds.length} prebuilds in dist-npm`);
      }
    }
  } else {
    console.log('  ⚠️  Prebuilds skipped in current-only mode');
  }
  
  // Validate package.json
  const packageJsonPath = path.join(DIST_DIR, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    // Check authenticate-pam is listed as optionalDependency
    if (packageJson.optionalDependencies && packageJson.optionalDependencies['authenticate-pam']) {
      console.log('  ✅ authenticate-pam listed as optional dependency');
    } else {
      warnings.push('authenticate-pam not listed as optional dependency (Linux PAM auth may not work)');
    }
    
    // Check postinstall script
    if (!packageJson.scripts || !packageJson.scripts.postinstall) {
      errors.push('Missing postinstall script in package.json');
    } else {
      console.log('  ✅ Postinstall script configured');
    }
  }
  
  // Report results
  if (errors.length > 0) {
    console.error('❌ Package validation failed:');
    errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }
  
  if (warnings.length > 0) {
    console.warn('⚠️  Package warnings:');
    warnings.forEach(warn => console.warn(`  - ${warn}`));
  }
  
  console.log('✅ Hybrid package validation passed\n');
}

// Main build process
async function main() {
  // Step 0: Clean previous build
  console.log('0️⃣ Cleaning previous build...');
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });
  
  // Step 1: Standard build process
  console.log('\n1️⃣ Running standard build process...\n');
  try {
    execSync('npm run build', { 
      cwd: ROOT_DIR, 
      stdio: 'inherit' 
    });
    console.log('✅ Standard build completed\n');
  } catch (error) {
    console.error('❌ Standard build failed:', error.message);
    process.exit(1);
  }
  
  // Step 2: Multi-platform native module builds (unless current-only)
  if (!currentOnly) {
    // Check Docker availability for Linux builds
    const hasDocker = checkDocker();
    
    // Build for macOS if included in targets
    if (PLATFORMS.darwin && process.platform === 'darwin') {
      buildMacOS();
    } else if (PLATFORMS.darwin && process.platform !== 'darwin') {
      console.log('⚠️  Skipping macOS builds (not running on macOS)\n');
    }
    
    // Build for Linux if included in targets
    if (PLATFORMS.linux && hasDocker && !noDocker) {
      buildLinux();
    } else if (PLATFORMS.linux) {
      console.log('⚠️  Skipping Linux builds (Docker not available or --no-docker specified)\n');
    }
    
    // Merge all prebuilds
    mergePrebuilds();
  }
  
  // Step 3: Copy necessary files to dist-npm
  console.log('3️⃣ Copying files to dist-npm...\n');
  
  const filesToCopy = [
    // Compiled CLI
    { src: 'dist/vibetunnel-cli', dest: 'lib/cli.js' },
    { src: 'dist/tsconfig.server.tsbuildinfo', dest: 'lib/tsconfig.server.tsbuildinfo' },
    
    // Bin scripts
    { src: 'bin', dest: 'bin' },
    
    // Public assets
    { src: 'public', dest: 'public' },
    
    // Node-pty module (bundled)
    { src: 'node-pty/lib', dest: 'node-pty/lib' },
    { src: 'node-pty/src', dest: 'node-pty/src' },
    { src: 'node-pty/binding.gyp', dest: 'node-pty/binding.gyp' },
    { src: 'node-pty/package.json', dest: 'node-pty/package.json' },
    { src: 'node-pty/README.md', dest: 'node-pty/README.md' },
    
    // Prebuilds
    { src: 'prebuilds', dest: 'prebuilds' },
    
    // Scripts
    { src: 'scripts/postinstall-npm.js', dest: 'scripts/postinstall.js' },
    { src: 'scripts/node-pty-plugin.js', dest: 'scripts/node-pty-plugin.js' },
    { src: 'scripts/install-vt-command.js', dest: 'scripts/install-vt-command.js' }
  ];
  
  function copyRecursive(src, dest) {
    const srcPath = path.join(ROOT_DIR, src);
    const destPath = path.join(DIST_DIR, dest);
    
    if (!fs.existsSync(srcPath)) {
      console.warn(`  ⚠️  Source not found: ${src}`);
      return;
    }
    
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    const stats = fs.statSync(srcPath);
    if (stats.isDirectory()) {
      fs.cpSync(srcPath, destPath, { recursive: true });
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
    
    console.log(`  ✓ ${src} → ${dest}`);
  }
  
  filesToCopy.forEach(({ src, dest }) => {
    copyRecursive(src, dest);
  });
  
  // Step 4: Bundle node-pty with dependencies
  bundleNodePty();
  
  // Step 5: Don't copy authenticate-pam - it's an optionalDependency that will be installed by npm
  // copyAuthenticatePam();
  
  // Step 6: Use package.npm.json if available, otherwise create clean package.json
  console.log('\n6️⃣ Creating package.json for npm...\n');
  
  const npmPackageJsonPath = path.join(ROOT_DIR, 'package.npm.json');
  let npmPackageJson;
  
  if (fs.existsSync(npmPackageJsonPath)) {
    // Use our enhanced package.npm.json
    console.log('Using package.npm.json configuration...');
    npmPackageJson = JSON.parse(fs.readFileSync(npmPackageJsonPath, 'utf8'));
    
    // Remove prebuild-install dependency (our approach is better)
    if (npmPackageJson.dependencies && npmPackageJson.dependencies['prebuild-install']) {
      delete npmPackageJson.dependencies['prebuild-install'];
      console.log('✅ Removed problematic prebuild-install dependency');
    }
  } else {
    // Fallback to creating clean package.json from source
    console.log('Creating clean package.json from source...');
    const sourcePackageJson = JSON.parse(
      fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')
    );
    
    // Extract only necessary fields for npm package
    npmPackageJson = {
      name: sourcePackageJson.name,
      version: sourcePackageJson.version,
      description: sourcePackageJson.description,
      keywords: sourcePackageJson.keywords,
      author: sourcePackageJson.author,
      license: sourcePackageJson.license,
      homepage: sourcePackageJson.homepage,
      repository: sourcePackageJson.repository,
      bugs: sourcePackageJson.bugs,
      
      // Main entry point
      main: 'lib/cli.js',
      
      // Bin scripts
      bin: {
        vibetunnel: './bin/vibetunnel',
        vt: './bin/vt'
      },
      
      // Only runtime dependencies
      dependencies: Object.fromEntries(
        Object.entries(sourcePackageJson.dependencies)
          .filter(([key]) => !key.includes('node-pty')) // Exclude node-pty, it's bundled
      ),
      
      // Minimal scripts
      scripts: {
        postinstall: 'node scripts/postinstall.js'
      },
      
      // Node.js requirements
      engines: sourcePackageJson.engines,
      os: sourcePackageJson.os,
      
      // Files to include (everything in dist-npm)
      files: [
        'lib/',
        'bin/',
        'public/',
        'node-pty/',
        'prebuilds/',
        'scripts/',
        'README.md'
      ]
    };
  }
  
  fs.writeFileSync(
    path.join(DIST_DIR, 'package.json'),
    JSON.stringify(npmPackageJson, null, 2) + '\n'
  );

  // Step 6: Fix the CLI structure and bin scripts
  console.log('\n6️⃣ Fixing CLI structure and bin scripts...\n');
  
  // The dist/vibetunnel-cli was copied to lib/cli.js
  // We need to rename it and create a wrapper
  const cliPath = path.join(DIST_DIR, 'lib', 'cli.js');
  const cliBundlePath = path.join(DIST_DIR, 'lib', 'vibetunnel-cli');
  
  // Rename the bundle
  fs.renameSync(cliPath, cliBundlePath);
  
  // Create a simple wrapper that requires the bundle
  const cliWrapperContent = `#!/usr/bin/env node
require('./vibetunnel-cli');
`;
  
  fs.writeFileSync(cliPath, cliWrapperContent, { mode: 0o755 });
  
  // Fix bin scripts to point to correct path
  const binVibetunnelPath = path.join(DIST_DIR, 'bin', 'vibetunnel');
  const binVibetunnelContent = `#!/usr/bin/env node

// Start the CLI - it handles all command routing including 'fwd'
const { spawn } = require('child_process');
const path = require('path');

const cliPath = path.join(__dirname, '..', 'lib', 'vibetunnel-cli');
const args = process.argv.slice(2);

const child = spawn('node', [cliPath, ...args], {
  stdio: 'inherit',
  env: process.env
});

child.on('exit', (code, signal) => {
  if (signal) {
    // Process was killed by signal, exit with 128 + signal number convention
    // Common signals: SIGTERM=15, SIGINT=2, SIGKILL=9
    const signalExitCode = signal === 'SIGTERM' ? 143 : 
                          signal === 'SIGINT' ? 130 : 
                          signal === 'SIGKILL' ? 137 : 128;
    process.exit(signalExitCode);
  } else {
    // Normal exit, use the exit code (or 0 if null)
    process.exit(code ?? 0);
  }
});
`;
  fs.writeFileSync(binVibetunnelPath, binVibetunnelContent, { mode: 0o755 });
  console.log('  ✓ Fixed bin/vibetunnel path');
  
  // vt script doesn't need fixing - it dynamically finds the binary
  
  // Step 7: Copy README from web directory
  console.log('\n7️⃣ Copying README from web directory...\n');
  
  const sourceReadmePath = path.join(ROOT_DIR, 'README.md');
  const destReadmePath = path.join(DIST_DIR, 'README.md');
  
  fs.copyFileSync(sourceReadmePath, destReadmePath);
  console.log('  ✓ Copied README.md from web directory');
  
  // Step 8: Clean up test files in dist-npm
  console.log('\n8️⃣ Cleaning up test files...\n');
  const testFiles = [
    'public/bundle/test.js',
    'public/test'  // Remove entire test directory
  ];
  
  for (const file of testFiles) {
    const filePath = path.join(DIST_DIR, file);
    if (fs.existsSync(filePath)) {
      if (fs.statSync(filePath).isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
        console.log(`  Removed directory: ${file}`);
      } else {
        fs.unlinkSync(filePath);
        console.log(`  Removed file: ${file}`);
      }
    }
  }
  
  // Step 9: Validate package with our comprehensive checks
  validatePackageHybrid();

  // Step 10: Create npm package
  console.log('\n9️⃣ Creating npm package...\n');
  try {
    execSync('npm pack', {
      cwd: DIST_DIR,
      stdio: 'inherit'
    });
    
    // Move the package to root directory
    const packageFiles = fs.readdirSync(DIST_DIR)
      .filter(f => f.endsWith('.tgz'));
    
    if (packageFiles.length > 0) {
      const packageFile = packageFiles[0];
      fs.renameSync(
        path.join(DIST_DIR, packageFile),
        path.join(ROOT_DIR, packageFile)
      );
      console.log(`\n✅ Package created: ${packageFile}`);
    }
  } catch (error) {
    console.error('❌ npm pack failed:', error.message);
    process.exit(1);
  }
  
  console.log('\n🎉 Hybrid npm build completed successfully!');
  console.log('\nNext steps:');
  console.log('  - Test locally: npm pack && npm install -g vibetunnel-*.tgz');
  console.log('  - Test Linux compatibility: Check authenticate-pam and fallback compilation');
  console.log('  - Publish: npm publish');
}

main().catch(error => {
  console.error('❌ Build failed:', error);
  process.exit(1);
});
