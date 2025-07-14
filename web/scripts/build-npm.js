#!/usr/bin/env node

/**
 * Unified npm build script for VibeTunnel
 * Builds for all platforms by default with complete prebuild support
 * 
 * Options:
 *   --current-only    Build for current platform/arch only (legacy mode)
 *   --no-docker      Skip Docker builds (Linux builds will be skipped)
 *   --platform <os>  Build for specific platform (darwin, linux)
 *   --arch <arch>    Build for specific architecture (x64, arm64)
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const NODE_VERSIONS = ['20', '22', '23', '24'];
const ALL_PLATFORMS = {
  darwin: ['x64', 'arm64'],
  linux: ['x64', 'arm64']
};

// Parse command line arguments
const args = process.argv.slice(2);
const currentOnly = args.includes('--current-only');
const noDocker = args.includes('--no-docker');
const platformFilter = args.find(arg => arg.startsWith('--platform'))?.split('=')[1] || 
                      (args.includes('--platform') ? args[args.indexOf('--platform') + 1] : null);
const archFilter = args.find(arg => arg.startsWith('--arch'))?.split('=')[1] || 
                  (args.includes('--arch') ? args[args.indexOf('--arch') + 1] : null);

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

console.log('🚀 Building VibeTunnel for npm distribution...\n');

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
  
  // Build authenticate-pam
  console.log('  Building authenticate-pam...');
  const rootDir = path.join(__dirname, '..');
  
  for (const nodeVersion of NODE_VERSIONS) {
    for (const arch of PLATFORMS.darwin || []) {
      console.log(`    → authenticate-pam for Node.js ${nodeVersion} ${arch}`);
      try {
        execSync(`npx prebuild --runtime node --target ${nodeVersion}.0.0 --arch ${arch} --tag-prefix authenticate-pam-v --upload false`, {
          cwd: rootDir,
          stdio: 'pipe',
          env: { ...process.env, npm_config_target_platform: 'darwin', npm_config_target_arch: arch }
        });
      } catch (error) {
        console.error(`      ❌ Failed to build authenticate-pam for Node.js ${nodeVersion} ${arch}`);
        console.error(`      Error: ${error.message}`);
        process.exit(1);
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
    
    # Install dependencies
    apt-get update -qq
    apt-get install -y -qq python3 make g++ git libpam0g-dev
    
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
        npm_config_target_platform=linux npm_config_target_arch=\$arch \\
          npx prebuild --runtime node --target \$node_version.0.0 --arch \$arch || exit 1
      done
    done
    
    # Build authenticate-pam for Linux  
    cd /workspace
    for node_version in ${NODE_VERSIONS.join(' ')}; do
      for arch in ${(PLATFORMS.linux || []).join(' ')}; do
        echo "Building authenticate-pam for Node.js \$node_version \$arch"
        npm_config_target_platform=linux npm_config_target_arch=\$arch \\
          npx prebuild --runtime node --target \$node_version.0.0 --arch \$arch --tag-prefix authenticate-pam-v --upload false || exit 1
      done
    done
    
    echo "Linux builds completed successfully"
  `;
  
  try {
    execSync(`docker run --rm -v "\${PWD}:/workspace" -w /workspace node:22-bookworm bash -c '${dockerScript}'`, {
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
  
  // authenticate-pam prebuilds should already be in root prebuilds directory
  
  // Count total prebuilds
  const allPrebuilds = fs.readdirSync(rootPrebuildsDir).filter(f => f.endsWith('.tar.gz'));
  const nodePtyCount = allPrebuilds.filter(f => f.startsWith('node-pty')).length;
  const pamCount = allPrebuilds.filter(f => f.startsWith('authenticate-pam')).length;
  
  console.log(`✅ Merged prebuilds: ${nodePtyCount} node-pty + ${pamCount} authenticate-pam = ${allPrebuilds.length} total\n`);
}

// Main build process
async function main() {
  // Step 1: Standard build process (includes spawn-helper)
  console.log('1️⃣ Running standard build process...\n');
  try {
    execSync('node scripts/build.js', { stdio: 'inherit' });
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
  
  // Step 3: Ensure node-pty is built for current platform
  console.log('3️⃣ Ensuring node-pty is built for current platform...\n');
  const nodePtyBuild = path.join(__dirname, '..', 'node-pty', 'build', 'Release', 'pty.node');
  if (!fs.existsSync(nodePtyBuild)) {
    console.log('  Building node-pty for current platform...');
    const nodePtyDir = path.join(__dirname, '..', 'node-pty');
    try {
      execSync('npm run install', { cwd: nodePtyDir, stdio: 'inherit' });
      console.log('✅ node-pty built successfully');
    } catch (error) {
      console.error('❌ Failed to build node-pty:', error.message);
      process.exit(1);
    }
  } else {
    console.log('✅ node-pty already built');
  }
  
  // Step 4: Create package-specific README
  console.log('\n4️⃣ Creating npm package README...\n');
  const readmeContent = `# VibeTunnel CLI

Full-featured terminal sharing server with web interface for macOS and Linux. Windows not yet supported.

## Installation

\`\`\`bash
npm install -g vibetunnel
\`\`\`

## Requirements

- Node.js >= 20.0.0
- macOS or Linux (Windows not yet supported)
- Build tools for native modules (Xcode on macOS, build-essential on Linux)

## Usage

### Start the server

\`\`\`bash
# Start with default settings (port 4020)
vibetunnel

# Start with custom port
vibetunnel --port 8080

# Start without authentication
vibetunnel --no-auth
\`\`\`

Then open http://localhost:4020 in your browser to access the web interface.

### Use the vt command wrapper

The \`vt\` command allows you to run commands with TTY forwarding:

\`\`\`bash
# Monitor AI agents with automatic activity tracking
vt claude
vt claude --dangerously-skip-permissions

# Run commands with output visible in VibeTunnel
vt npm test
vt python script.py
vt top

# Launch interactive shell
vt --shell
vt -i

# Update session title (inside a session)
vt title "My Project"
\`\`\`

### Forward commands to a session

\`\`\`bash
# Basic usage
vibetunnel fwd <session-id> <command> [args...]

# Examples
vibetunnel fwd --session-id abc123 ls -la
vibetunnel fwd --session-id abc123 npm test
vibetunnel fwd --session-id abc123 python script.py
\`\`\`

## Features

- **Web-based terminal interface** - Access terminals from any browser
- **Multiple concurrent sessions** - Run multiple terminals simultaneously
- **Real-time synchronization** - See output in real-time
- **TTY forwarding** - Full terminal emulation support
- **Session management** - Create, list, and manage sessions
- **Cross-platform** - Works on macOS and Linux
- **No dependencies** - Just Node.js required

## Package Contents

This npm package includes:
- Full VibeTunnel server with web UI
- Command-line tools (vibetunnel, vt)
- Native PTY support for terminal emulation
- Web interface with xterm.js
- Session management and forwarding

## Platform Support

- macOS (Intel and Apple Silicon)
- Linux (x64 and ARM64)
- Windows: Not yet supported ([#252](https://github.com/amantus-ai/vibetunnel/issues/252))

## Documentation

See the main repository for complete documentation: https://github.com/amantus-ai/vibetunnel

## License

MIT
`;

  const readmePath = path.join(__dirname, '..', 'README.md');
  fs.writeFileSync(readmePath, readmeContent);
  console.log('✅ npm README created');

  // Step 5: Clean up test files (keep screencap.js - it's needed)
  console.log('\n5️⃣ Cleaning up test files...\n');
  const testFiles = [
    'public/bundle/test.js',
    'public/test'  // Remove entire test directory
  ];

  for (const file of testFiles) {
    const filePath = path.join(__dirname, '..', file);
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

  // Step 6: Show final package info
  console.log('\n6️⃣ Package summary...\n');
  
  // Calculate total size
  function getDirectorySize(dirPath) {
    let totalSize = 0;
    const items = fs.readdirSync(dirPath);
    
    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      const stats = fs.statSync(itemPath);
      
      if (stats.isFile()) {
        totalSize += stats.size;
      } else if (stats.isDirectory()) {
        totalSize += getDirectorySize(itemPath);
      }
    }
    
    return totalSize;
  }
  
  const packageRoot = path.join(__dirname, '..');
  const totalSize = getDirectorySize(packageRoot);
  const sizeMB = (totalSize / 1024 / 1024).toFixed(1);
  
  console.log(`📦 Package size: ${sizeMB} MB`);
  
  if (!currentOnly) {
    const prebuildsDir = path.join(__dirname, '..', 'prebuilds');
    if (fs.existsSync(prebuildsDir)) {
      const prebuildFiles = fs.readdirSync(prebuildsDir).filter(f => f.endsWith('.tar.gz'));
      console.log(`🔧 Prebuilds: ${prebuildFiles.length} binaries included`);
    }
  }
  
  console.log('\n🎉 npm package build completed successfully!');
  console.log('\nNext steps:');
  console.log('  - Test locally: npm pack');
  console.log('  - Publish: npm publish');
}

main().catch(error => {
  console.error('❌ Build failed:', error);
  process.exit(1);
});