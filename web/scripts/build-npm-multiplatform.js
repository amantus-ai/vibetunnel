#!/usr/bin/env node

/**
 * Multi-platform build script for npm package distribution
 * Builds native modules for macOS (locally) and Linux (via Docker)
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const NODE_VERSIONS = ['20', '22', '23', '24'];
const PLATFORMS = {
  darwin: ['x64', 'arm64'],
  linux: ['x64', 'arm64']
};

console.log('🚀 Building VibeTunnel for npm distribution (multi-platform)...\n');

// Check if Docker is available for Linux builds
function checkDocker() {
  try {
    execSync('docker --version', { stdio: 'pipe' });
    return true;
  } catch (e) {
    console.error('❌ Docker is required for multi-platform builds but is not installed.');
    console.error('Please install Docker using one of these options:');
    console.error('  - OrbStack (recommended): https://orbstack.dev/');
    console.error('  - Docker Desktop: https://www.docker.com/products/docker-desktop/');
    process.exit(1);
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
    console.log(`    Node.js ${nodeVersion}...`);
    try {
      execSync(`npx prebuild --runtime node --target ${nodeVersion}.0.0`, {
        stdio: 'inherit',
        cwd: nodePtyDir,
        env: { ...process.env }
      });
    } catch (error) {
      console.error(`    ❌ Failed to build node-pty for Node.js ${nodeVersion}:`, error.message);
    }
  }
  
  // Build authenticate-pam
  console.log('\n  Building authenticate-pam...');
  const pamDir = path.join(__dirname, '..', 'node_modules', '.pnpm', 'authenticate-pam@1.0.5', 'node_modules', 'authenticate-pam');
  
  // First add prebuild support to authenticate-pam
  const pamPrebuildrcPath = path.join(pamDir, '.prebuildrc');
  const prebuildrcContent = JSON.stringify({
    targets: NODE_VERSIONS.map(v => ({ runtime: 'node', target: `${v}.0.0` }))
  }, null, 2);
  fs.writeFileSync(pamPrebuildrcPath, prebuildrcContent);
  
  // Install prebuild in authenticate-pam directory
  try {
    execSync('npm install prebuild', { cwd: pamDir, stdio: 'pipe' });
  } catch (e) {
    // Try with global prebuild
  }
  
  for (const nodeVersion of NODE_VERSIONS) {
    console.log(`    Node.js ${nodeVersion}...`);
    try {
      // Build for all supported architectures on macOS
      execSync(`npx prebuild --runtime node --target ${nodeVersion}.0.0 --arch x64`, {
        stdio: 'inherit',
        cwd: pamDir,
        env: { ...process.env }
      });
      execSync(`npx prebuild --runtime node --target ${nodeVersion}.0.0 --arch arm64`, {
        stdio: 'inherit',
        cwd: pamDir,
        env: { ...process.env }
      });
    } catch (error) {
      console.error(`    ❌ Failed to build authenticate-pam for Node.js ${nodeVersion}:`, error.message);
    }
  }
  
  // Copy all prebuilds to root
  const rootPrebuilds = path.join(__dirname, '..', 'prebuilds');
  if (!fs.existsSync(rootPrebuilds)) {
    fs.mkdirSync(rootPrebuilds, { recursive: true });
  }
  
  // Copy node-pty prebuilds
  const nodePtyPrebuilds = path.join(nodePtyDir, 'prebuilds');
  if (fs.existsSync(nodePtyPrebuilds)) {
    console.log('\n  Copying node-pty prebuilds to root...');
    const files = fs.readdirSync(nodePtyPrebuilds);
    files.forEach(file => {
      fs.copyFileSync(
        path.join(nodePtyPrebuilds, file),
        path.join(rootPrebuilds, file)
      );
    });
  }
  
  // Copy authenticate-pam prebuilds
  const pamPrebuilds = path.join(pamDir, 'prebuilds');
  if (fs.existsSync(pamPrebuilds)) {
    console.log('  Copying authenticate-pam prebuilds to root...');
    const files = fs.readdirSync(pamPrebuilds);
    files.forEach(file => {
      fs.copyFileSync(
        path.join(pamPrebuilds, file),
        path.join(rootPrebuilds, file)
      );
    });
  }
}

// Build for Linux using Docker
async function buildLinux() {
  console.log('\n🐧 Building Linux binaries using Docker...\n');
  
  // Docker check will exit if not available
  checkDocker();

  // Create a temporary build script for Docker
  const dockerBuildScript = `#!/bin/bash
set -e

echo "Installing build dependencies..."
apt-get update && apt-get install -y python3 make g++ git libpam0g-dev

echo "Setting up project..."
cd /workspace

# Fix npm permissions issue in Docker
mkdir -p ~/.npm
chown -R $(id -u):$(id -g) ~/.npm

# Install pnpm using corepack (more reliable)
corepack enable
corepack prepare pnpm@latest --activate

# Install dependencies
cd /workspace
CI=true pnpm install --ignore-scripts --no-frozen-lockfile --force

# Build node-pty
echo "Building node-pty..."
cd node-pty

# Install prebuild locally in node-pty
pnpm add -D prebuild

# Build for each Node version
for NODE_VERSION in ${NODE_VERSIONS.join(' ')}; do
  echo "Building node-pty for Node.js \$NODE_VERSION..."
  ./node_modules/.bin/prebuild --runtime node --target \${NODE_VERSION}.0.0
done

# Copy node-pty prebuilds to output directory
mkdir -p /output/prebuilds
cp -r prebuilds/* /output/prebuilds/ || true

# Build authenticate-pam
echo "Building authenticate-pam..."
cd /workspace

# Find authenticate-pam directory
PAM_DIR=\$(find node_modules -name "authenticate-pam" -type d | head -1)
if [ -n "\$PAM_DIR" ]; then
  echo "Found authenticate-pam at: \$PAM_DIR"
  cd "\$PAM_DIR"
  
  # Create .prebuildrc for authenticate-pam
  cat > .prebuildrc << 'PREBUILD_EOF'
{
  "targets": [
    {"runtime": "node", "target": "20.0.0"},
    {"runtime": "node", "target": "22.0.0"},
    {"runtime": "node", "target": "23.0.0"},
    {"runtime": "node", "target": "24.0.0"}
  ]
}
PREBUILD_EOF
  
  # Install dependencies (nan) if not present
  if [ ! -d node_modules ]; then
    echo "Installing authenticate-pam dependencies..."
    pnpm install --ignore-scripts
  fi
  
  # Install prebuild
  echo "Installing prebuild..."
  pnpm add -D prebuild
  
  # Ensure output directory exists
  mkdir -p prebuilds
  
  # Build for each Node version explicitly
  for NODE_VERSION in 20 22 23 24; do
    echo "Building authenticate-pam for Node.js \$NODE_VERSION..."
    if ./node_modules/.bin/prebuild --runtime node --target \${NODE_VERSION}.0.0; then
      echo "✓ Built authenticate-pam for Node.js \$NODE_VERSION"
    else
      echo "✗ Failed to build authenticate-pam for Node.js \$NODE_VERSION"
    fi
  done
  
  # List what was built
  echo "authenticate-pam prebuilds created:"
  ls -la prebuilds/ || echo "No prebuilds directory found"
  
  # Copy authenticate-pam prebuilds to output directory
  if [ -d prebuilds ] && [ "\$(ls -A prebuilds)" ]; then
    echo "Copying authenticate-pam prebuilds..."
    cp -r prebuilds/* /output/prebuilds/
  else
    echo "No authenticate-pam prebuilds to copy"
  fi
else
  echo "Warning: authenticate-pam directory not found"
  find node_modules -name "*pam*" -type d || echo "No PAM directories found"
fi
`;

  const dockerScriptPath = path.join(__dirname, 'docker-build.sh');
  fs.writeFileSync(dockerScriptPath, dockerBuildScript, { mode: 0o755 });

  try {
    // Build for x64
    console.log('  Building for Linux x64...');
    execSync(`docker run --rm \
      -v "${path.dirname(__dirname)}":/workspace \
      -v "${path.dirname(__dirname)}/prebuilds-linux":/output \
      -w /workspace \
      --platform linux/amd64 \
      node:22-bookworm \
      /workspace/scripts/docker-build.sh`, {
      stdio: 'inherit'
    });

    // Build for arm64
    console.log('\n  Building for Linux arm64...');
    execSync(`docker run --rm \
      -v "${path.dirname(__dirname)}":/workspace \
      -v "${path.dirname(__dirname)}/prebuilds-linux":/output \
      -w /workspace \
      --platform linux/arm64 \
      node:22-bookworm \
      /workspace/scripts/docker-build.sh`, {
      stdio: 'inherit'
    });

  } catch (error) {
    console.error('  ❌ Docker build failed:', error.message);
  } finally {
    // Clean up
    fs.unlinkSync(dockerScriptPath);
  }
}

// Merge all prebuilds into the prebuilds directory
function mergePrebuilds() {
  console.log('\n📦 Merging prebuilt binaries...\n');
  
  const prebuildsDir = path.join(__dirname, '..', 'prebuilds');
  const linuxPrebuildsDir = path.join(__dirname, '..', 'prebuilds-linux', 'prebuilds');
  
  // Ensure prebuilds directory exists
  if (!fs.existsSync(prebuildsDir)) {
    fs.mkdirSync(prebuildsDir, { recursive: true });
  }

  // Copy Linux prebuilds if they exist
  if (fs.existsSync(linuxPrebuildsDir)) {
    console.log('  Copying Linux prebuilds...');
    const copyRecursive = (src, dest) => {
      const exists = fs.existsSync(src);
      const stats = exists && fs.statSync(src);
      const isDirectory = exists && stats.isDirectory();
      
      if (isDirectory) {
        if (!fs.existsSync(dest)) {
          fs.mkdirSync(dest, { recursive: true });
        }
        fs.readdirSync(src).forEach(child => {
          copyRecursive(path.join(src, child), path.join(dest, child));
        });
      } else {
        fs.copyFileSync(src, dest);
      }
    };
    
    copyRecursive(linuxPrebuildsDir, prebuildsDir);
    
    // Clean up Linux prebuilds directory
    fs.rmSync(path.dirname(linuxPrebuildsDir), { recursive: true, force: true });
  }

  // List all prebuilds
  console.log('\n  Available prebuilds:');
  const listPrebuilds = (dir, indent = '    ') => {
    if (!fs.existsSync(dir)) return;
    
    const files = fs.readdirSync(dir);
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        console.log(`${indent}${file}/`);
        listPrebuilds(filePath, indent + '  ');
      } else if (file.endsWith('.tar.gz')) {
        console.log(`${indent}${file}`);
      }
    });
  };
  listPrebuilds(prebuildsDir);
}

// Main build process
async function build() {
  // Step 1: Run the standard build process
  console.log('1️⃣  Running standard build process...\n');
  try {
    execSync('node scripts/build.js', { stdio: 'inherit' });
    console.log('✅ Build completed successfully\n');
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
  }

  // Step 2: Build native modules for all platforms
  console.log('2️⃣  Building native modules for all platforms...\n');
  
  // Build for macOS
  buildMacOS();
  
  // Build for Linux
  await buildLinux();
  
  // Merge all prebuilds
  mergePrebuilds();

  // Step 3: Update README and clean up
  console.log('\n3️⃣  Finalizing package...\n');
  
  // Use the existing build-npm.js for final steps
  try {
    execSync('node scripts/build-npm.js', { stdio: 'inherit' });
  } catch (error) {
    console.error('Failed to run final build steps:', error.message);
  }

  console.log('\n✅ Multi-platform build complete!');
  console.log('\nThe package now includes prebuilt binaries for:');
  console.log('  - macOS (x64, arm64) - Node.js 20, 22, 23, 24');
  console.log('  - Linux (x64, arm64) - Node.js 20, 22, 23, 24');
  console.log('\nTo test: npm pack');
  console.log('To publish: npm publish');
}

// Run the build
build().catch(error => {
  console.error('Build failed:', error);
  process.exit(1);
});