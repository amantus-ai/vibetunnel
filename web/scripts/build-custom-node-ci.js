#!/usr/bin/env node

/**
 * CI-optimized version of build-custom-node.js
 * 
 * Differences from the main script:
 * - Optimized for Linux CI environments
 * - Better error handling for CI
 * - Outputs GitHub Actions variables
 * - Supports ccache for faster rebuilds
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Helper to download files
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
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

// Helper for GitHub Actions output
function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
  console.log(`::set-output name=${name}::${value}`);
}

async function buildCustomNode() {
  const nodeSourceVersion = process.env.NODE_VERSION || '24.2.0';
  const platform = process.platform;
  const arch = process.arch;
  
  console.log(`Building custom Node.js ${nodeSourceVersion} for ${platform}-${arch}...`);
  
  const nodeSourceUrl = `https://nodejs.org/dist/v${nodeSourceVersion}/node-v${nodeSourceVersion}.tar.gz`;
  const buildDir = path.join(__dirname, '..', '.node-builds');
  const versionDir = path.join(buildDir, `node-v${nodeSourceVersion}-minimal`);
  const markerFile = path.join(versionDir, '.build-complete');
  const customNodePath = path.join(versionDir, 'out', 'Release', 'node');
  
  // Check if already built
  if (fs.existsSync(markerFile) && fs.existsSync(customNodePath)) {
    console.log(`Using cached custom Node.js build from ${customNodePath}`);
    const stats = fs.statSync(customNodePath);
    console.log(`Cached custom Node.js size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
    // Set outputs for GitHub Actions
    setOutput('node-path', customNodePath);
    setOutput('node-size', stats.size);
    setOutput('cache-hit', 'true');
    
    return customNodePath;
  }
  
  // Create build directory
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }
  
  // Clean up incomplete builds
  if (fs.existsSync(versionDir) && !fs.existsSync(markerFile)) {
    console.log('Cleaning up incomplete build...');
    fs.rmSync(versionDir, { recursive: true, force: true });
  }
  
  const tarPath = path.join(buildDir, `node-v${nodeSourceVersion}.tar.gz`);
  const originalCwd = process.cwd();
  
  try {
    // Download Node.js source
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
      '--without-intl',
      '--without-npm', 
      '--without-corepack',
      '--without-inspector',
      '--without-node-code-cache',
      '--without-node-snapshot'
    ];
    
    // Check for ninja
    try {
      execSync('which ninja', { stdio: 'ignore' });
      configureArgs.push('--ninja');
      console.log('Using Ninja for faster builds...');
    } catch {
      console.log('Ninja not found, using Make...');
    }
    
    // Enable ccache if available
    if (process.env.CI) {
      try {
        execSync('which ccache', { stdio: 'ignore' });
        process.env.CC = 'ccache gcc';
        process.env.CXX = 'ccache g++';
        console.log('Using ccache for faster rebuilds...');
      } catch {
        console.log('ccache not found, proceeding without it...');
      }
    }
    
    // Use -Os optimization
    process.env.CFLAGS = '-Os';
    process.env.CXXFLAGS = '-Os';
    
    execSync(`./configure ${configureArgs.join(' ')}`, { stdio: 'inherit' });
    
    console.log('Building Node.js...');
    const cores = require('os').cpus().length;
    const buildCmd = configureArgs.includes('--ninja') 
      ? `ninja -C out/Release -j ${cores}`
      : `make -j${cores}`;
    
    const startTime = Date.now();
    execSync(buildCmd, { stdio: 'inherit' });
    const buildTime = Math.round((Date.now() - startTime) / 1000);
    console.log(`Build completed in ${buildTime} seconds`);
    
    // Verify the build
    if (!fs.existsSync(customNodePath)) {
      throw new Error('Node.js build failed - binary not found');
    }
    
    // Test the binary
    const version = execSync(`"${customNodePath}" --version`, { encoding: 'utf8' }).trim();
    console.log(`Built Node.js version: ${version}`);
    
    // Strip the binary
    console.log('Stripping Node.js binary...');
    const stripCmd = platform === 'darwin' ? 'strip -S' : 'strip -s';
    execSync(`${stripCmd} "${customNodePath}"`, { stdio: 'inherit' });
    
    // Check final size
    const stats = fs.statSync(customNodePath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`Custom Node.js built successfully! Size: ${sizeMB} MB`);
    
    // Mark build as complete
    const buildInfo = {
      version: nodeSourceVersion,
      buildDate: new Date().toISOString(),
      size: stats.size,
      platform: platform,
      arch: arch,
      buildTime: buildTime,
      configureArgs: configureArgs
    };
    fs.writeFileSync(markerFile, JSON.stringify(buildInfo, null, 2));
    
    // Create a summary file for CI
    const summaryPath = path.join(versionDir, 'build-summary.txt');
    const summary = `
Custom Node.js Build Summary
============================
Version: ${nodeSourceVersion}
Platform: ${platform}-${arch}
Size: ${sizeMB} MB
Build Time: ${buildTime} seconds
Configure Args: ${configureArgs.join(' ')}
Path: ${customNodePath}
`;
    fs.writeFileSync(summaryPath, summary);
    
    process.chdir(originalCwd);
    
    // Set outputs for GitHub Actions
    setOutput('node-path', customNodePath);
    setOutput('node-size', stats.size);
    setOutput('node-version', version);
    setOutput('build-time', buildTime);
    setOutput('cache-hit', 'false');
    
    // Also output for local use
    console.log(`\nCustom Node.js location: ${customNodePath}`);
    console.log(`To use with build-native.js:`);
    console.log(`node build-native.js --custom-node="${customNodePath}"`);
    
    return customNodePath;
    
  } catch (error) {
    process.chdir(originalCwd);
    console.error('Failed to build custom Node.js:', error);
    
    // Set error output for CI
    if (process.env.CI) {
      setOutput('build-error', error.message);
    }
    
    process.exit(1);
  }
}

// Run the build
if (require.main === module) {
  buildCustomNode().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
  });
}

module.exports = { buildCustomNode };