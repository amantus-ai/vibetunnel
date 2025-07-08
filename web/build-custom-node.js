#!/usr/bin/env node

/**
 * Build a custom Node.js binary with reduced size by excluding features we don't need.
 * 
 * This script automatically adapts to CI and local environments.
 * 
 * Usage:
 *   node build-custom-node.js                    # Builds Node.js 24.2.0 (recommended)
 *   node build-custom-node.js --latest           # Latest version
 *   node build-custom-node.js --version=24.2.0   # Specific version
 *   NODE_VERSION=24.2.0 node build-custom-node.js  # Via environment variable (CI)
 * 
 * In CI environments:
 *   - Outputs GitHub Actions variables
 *   - Uses ccache if available
 *   - Creates build summary files
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Detect if running in CI
const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

// Parse command line arguments
const args = process.argv.slice(2);
let targetVersion = null;
let useLatest = false;

for (const arg of args) {
  if (arg.startsWith('--version=')) {
    targetVersion = arg.split('=')[1];
  } else if (arg === '--latest') {
    useLatest = true;
  }
}

// Helper for GitHub Actions output
function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

// Helper to download files
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirect
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

// Helper to get latest Node.js version
async function getLatestNodeVersion() {
  return new Promise((resolve, reject) => {
    https.get('https://nodejs.org/dist/latest/SHASUMS256.txt', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // Extract version from first line like: "1234567890abcdef  node-v24.2.0-darwin-arm64.tar.gz"
        const match = data.match(/node-v(\d+\.\d+\.\d+)/);
        if (match) {
          resolve(match[1]);
        } else {
          reject(new Error('Could not determine latest Node.js version'));
        }
      });
    }).on('error', reject);
  });
}

async function buildCustomNode() {
  // Determine version to build (CLI args take precedence over env vars)
  let nodeSourceVersion;
  if (useLatest) {
    console.log('Fetching latest Node.js version...');
    nodeSourceVersion = await getLatestNodeVersion();
    console.log(`Latest Node.js version: ${nodeSourceVersion}`);
  } else if (targetVersion) {
    nodeSourceVersion = targetVersion;
  } else if (process.env.NODE_VERSION) {
    // Support CI environment variable
    nodeSourceVersion = process.env.NODE_VERSION;
  } else {
    // Default to Node.js 24.3.0 (recommended version)
    nodeSourceVersion = '24.3.0';
  }
  
  const platform = process.platform;
  const arch = process.arch;
  
  console.log(`Building custom Node.js ${nodeSourceVersion} for ${platform}-${arch}...`);
  console.log('This will take 10-20 minutes on first run, but will be cached for future builds.');
  
  const nodeSourceUrl = `https://nodejs.org/dist/v${nodeSourceVersion}/node-v${nodeSourceVersion}.tar.gz`;
  const majorVersion = nodeSourceVersion.split('.')[0];
  
  // In CI scripts directory, go up one level to find web root
  const buildDir = path.join(__dirname, __dirname.endsWith('scripts') ? '..' : '.', '.node-builds');
  const versionDir = path.join(buildDir, `node-v${nodeSourceVersion}-minimal`);
  const markerFile = path.join(versionDir, '.build-complete');
  const customNodePath = path.join(versionDir, 'out', 'Release', 'node');
  
  // Check if already built
  if (fs.existsSync(markerFile) && fs.existsSync(customNodePath)) {
    console.log(`Using cached custom Node.js build from ${customNodePath}`);
    const stats = fs.statSync(customNodePath);
    console.log(`Cached custom Node.js size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
    if (isCI) {
      // Set outputs for GitHub Actions
      setOutput('node-path', customNodePath);
      setOutput('node-size', stats.size);
      setOutput('cache-hit', 'true');
    } else {
      console.log(`\nTo use this custom Node.js with build-native.js:`);
      console.log(`node build-native.js --custom-node="${customNodePath}"`);
    }
    return customNodePath;
  }
  
  // Create build directory
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }
  
  // Clean up incomplete builds (check for marker file)
  if (fs.existsSync(versionDir) && !fs.existsSync(markerFile)) {
    console.log('Cleaning up incomplete build...');
    fs.rmSync(versionDir, { recursive: true, force: true });
  }
  
  const tarPath = path.join(buildDir, `node-v${nodeSourceVersion}.tar.gz`);
  const originalCwd = process.cwd();
  
  try {
    // Download Node.js source if not cached
    if (!fs.existsSync(tarPath)) {
      console.log(`Downloading Node.js source from ${nodeSourceUrl}...`);
      await downloadFile(nodeSourceUrl, tarPath);
    }
    
    // Extract source
    console.log('Extracting Node.js source...');
    execSync(`tar -xzf "${tarPath}" -C "${buildDir}"`, { stdio: 'inherit' });
    
    // Rename to version-specific directory
    const extractedDir = path.join(buildDir, `node-v${nodeSourceVersion}`);
    if (fs.existsSync(extractedDir)) {
      fs.renameSync(extractedDir, versionDir);
    }
    
    // Configure and build
    process.chdir(versionDir);
    
    console.log('Configuring Node.js build...');
    const configureArgs = [
      '--without-intl',  // Remove internationalization support
      '--without-npm',   // Don't include npm
      '--without-corepack', // Don't include corepack
      '--without-inspector', // Remove debugging/profiling features
      '--without-node-code-cache', // Disable code cache
      '--without-node-snapshot',  // Don't create/use startup snapshot
      '--shared-zlib',     // Use system zlib instead of building custom
    ];
    
    // Check if ninja is available
    try {
      execSync('which ninja', { stdio: 'ignore' });
      configureArgs.push('--ninja');
      console.log('Using Ninja for faster builds...');
    } catch {
      console.log('Ninja not found, using Make...');
    }
    
    
    // Enable ccache if available in system paths
    try {
      execSync('which ccache', { stdio: 'ignore' });
      process.env.CC = 'ccache gcc';
      process.env.CXX = 'ccache g++';
      console.log('Using ccache for faster rebuilds...');
    } catch {
      console.log('ccache not found, proceeding without it...');
    }
    
    // Use -Os optimization which is proven to be safe
    process.env.CFLAGS = '-Os';
    process.env.CXXFLAGS = '-Os';
    
    execSync(`./configure ${configureArgs.join(' ')}`, { stdio: 'inherit' });
    
    console.log('Building Node.js (this will take a while)...');
    const cores = require('os').cpus().length;
    const startTime = Date.now();
    
    // Check if we're using ninja or make
    const buildCmd = configureArgs.includes('--ninja')
      ? `ninja -C out/Release -j ${cores}`
      : `make -j${cores}`;
    
    execSync(buildCmd, { stdio: 'inherit' });
    
    const buildTime = Math.round((Date.now() - startTime) / 1000);
    if (isCI) {
      console.log(`Build completed in ${buildTime} seconds`);
    }
    
    // Verify the build
    if (!fs.existsSync(customNodePath)) {
      throw new Error('Node.js build failed - binary not found');
    }
    
    // Test the binary
    const version = execSync(`"${customNodePath}" --version`, { encoding: 'utf8' }).trim();
    console.log(`Built Node.js version: ${version}`);
    
    // Strip the binary (different command for Linux vs macOS)
    console.log('Stripping Node.js binary...');
    const stripCmd = platform === 'darwin' ? 'strip -S' : 'strip -s';
    execSync(`${stripCmd} "${customNodePath}"`, { stdio: 'inherit' });
    
    // Check final size
    const stats = fs.statSync(customNodePath);
    console.log(`\n✅ Custom Node.js built successfully!`);
    console.log(`Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
    // Compare with system Node.js
    try {
      const systemNodeStats = fs.statSync(process.execPath);
      const reduction = ((systemNodeStats.size - stats.size) / systemNodeStats.size * 100).toFixed(1);
      console.log(`Size reduction: ${reduction}% compared to system Node.js`);
    } catch (e) {
      // Ignore if we can't stat system node
    }
    
    // Mark build as complete
    const buildInfo = {
      version: nodeSourceVersion,
      buildDate: new Date().toISOString(),
      size: stats.size,
      platform: platform,
      arch: arch,
      configureArgs: configureArgs,
      buildTime: buildTime
    };
    
    fs.writeFileSync(markerFile, JSON.stringify(buildInfo, null, 2));
    
    // Create a summary file
    const summaryPath = path.join(versionDir, 'build-summary.txt');
    const summary = `
Custom Node.js Build Summary
============================
Version: ${nodeSourceVersion}
Platform: ${platform}-${arch}
Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB
Build Time: ${buildTime} seconds
Configure Args: ${configureArgs.join(' ')}
Path: ${customNodePath}
`;
    fs.writeFileSync(summaryPath, summary);
    
    
    // Change back to original directory
    process.chdir(originalCwd);
    
    if (isCI) {
      // Set outputs for GitHub Actions
      setOutput('node-path', customNodePath);
      setOutput('node-size', stats.size);
      setOutput('node-version', version);
      setOutput('build-time', buildTime);
      setOutput('cache-hit', 'false');
    }
    
    // Output for both CI and local use
    console.log(`\nCustom Node.js location: ${customNodePath}`);
    console.log(`To use this custom Node.js with build-native.js:`);
    console.log(`node build-native.js --custom-node="${customNodePath}"`);
    
    return customNodePath;
    
  } catch (error) {
    process.chdir(originalCwd);
    console.error('Failed to build custom Node.js:', error.message || error);
    
    // Set error output for CI
    if (isCI) {
      setOutput('build-error', error.message || 'Unknown error');
    }
    
    process.exit(1);
  }
}

// Run the build if called directly
if (require.main === module) {
  buildCustomNode().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
  });
}

// Export for use as a module
module.exports = { buildCustomNode };