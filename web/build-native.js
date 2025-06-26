#!/usr/bin/env node

/**
 * Build standalone vibetunnel executable using Node.js SEA (Single Executable Application)
 *
 * This script creates a portable executable that bundles the VibeTunnel server into a single
 * binary using Node.js's built-in SEA feature. The resulting executable can run on any machine
 * with the same OS/architecture without requiring Node.js to be installed.
 *
 * ## Output
 * Creates a `native/` directory with just 3 files:
 * - `vibetunnel` - The standalone executable (includes all JS code and sourcemaps)
 * - `pty.node` - Native binding for terminal emulation
 * - `spawn-helper` - Helper binary for spawning processes (Unix only)
 *
 * ## Usage
 * ```bash
 * node build-native.js                    # Build with system Node.js
 * node build-native.js --sourcemap        # Build with inline sourcemaps
 * node build-native.js --custom-node=/path/to/node  # Use custom Node.js binary
 * ```
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const includeSourcemaps = process.argv.includes('--sourcemap');
let customNodePath = null;

// Parse --custom-node argument
for (let i = 0; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith('--custom-node=')) {
    customNodePath = arg.split('=')[1];
  } else if (arg === '--custom-node' && i + 1 < process.argv.length) {
    customNodePath = process.argv[i + 1];
  }
}

console.log('Building standalone vibetunnel executable using Node.js SEA...');
console.log(`System Node.js version: ${process.version}`);
if (includeSourcemaps) {
  console.log('Including sourcemaps in build');
}

// Check Node.js version
const nodeVersion = parseInt(process.version.split('.')[0].substring(1));
if (nodeVersion < 20) {
  console.error('Error: Node.js 20 or higher is required for SEA feature');
  process.exit(1);
}

// Cleanup function
function cleanup() {
  if (fs.existsSync('build') && !process.argv.includes('--keep-build')) {
    console.log('Cleaning up build directory...');
    fs.rmSync('build', { recursive: true, force: true });
  }
}

// Ensure cleanup happens on exit
process.on('exit', cleanup);
process.on('SIGINT', () => {
  console.log('\nBuild interrupted');
  process.exit(1);
});
process.on('SIGTERM', () => {
  console.log('\nBuild terminated');
  process.exit(1);
});

async function main() {
  try {
    // Create build directory
    if (!fs.existsSync('build')) {
      fs.mkdirSync('build');
    }

    // Create native directory
    if (!fs.existsSync('native')) {
      fs.mkdirSync('native');
    }

    // 0. Determine which Node.js to use
    let nodeExe = process.execPath;
    if (customNodePath) {
      // Validate custom node exists
      if (!fs.existsSync(customNodePath)) {
        console.error(`Error: Custom Node.js not found at ${customNodePath}`);
        console.error('Build one using: node build-custom-node.js');
        process.exit(1);
      }
      nodeExe = customNodePath;
    }

    console.log(`Using Node.js binary: ${nodeExe}`);
    const nodeStats = fs.statSync(nodeExe);
    console.log(`Node.js binary size: ${(nodeStats.size / 1024 / 1024).toFixed(2)} MB`);

    // 1. Rebuild native modules if using custom Node.js
    if (customNodePath) {
      console.log('\nCustom Node.js detected - rebuilding native modules...');
      const customVersion = execSync(`"${nodeExe}" --version`, { encoding: 'utf8' }).trim();
      console.log(`Custom Node.js version: ${customVersion}`);
      
      execSync(`pnpm rebuild node-pty authenticate-pam`, {
        stdio: 'inherit',
        env: {
          ...process.env,
          npm_config_runtime: 'node',
          npm_config_target: customVersion.substring(1), // Remove 'v' prefix
          npm_config_arch: process.arch,
          npm_config_target_arch: process.arch,
          npm_config_disturl: 'https://nodejs.org/dist',
          npm_config_build_from_source: 'true'
        }
      });
    }

    // 2. Bundle TypeScript with esbuild
    console.log('\nBundling TypeScript with esbuild...');
    
    // Use deterministic timestamps based on git commit or source
    let buildDate = new Date().toISOString();
    let buildTimestamp = Date.now();
    
    try {
      // Try to use the last commit date for reproducible builds
      const gitDate = execSync('git log -1 --format=%cI', { encoding: 'utf8' }).trim();
      buildDate = gitDate;
      buildTimestamp = new Date(gitDate).getTime();
      console.log(`Using git commit date for reproducible build: ${buildDate}`);
    } catch (e) {
      // Fallback to current time
      console.warn('Warning: Using current time for build - output will not be reproducible');
    }

    let esbuildCmd = `NODE_NO_WARNINGS=1 npx esbuild src/cli.ts \\
      --bundle \\
      --platform=node \\
      --target=node20 \\
      --outfile=build/bundle.js \\
      --format=cjs \\
      --keep-names \\
      --external:authenticate-pam \\
      --define:process.env.BUILD_DATE='"${buildDate}"' \\
      --define:process.env.BUILD_TIMESTAMP='"${buildTimestamp}"' \\
      --define:process.env.VIBETUNNEL_SEA='"true"'`;
    
    // Also inject git commit hash for version tracking
    try {
      const gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
      esbuildCmd += ` \\\n      --define:process.env.GIT_COMMIT='"${gitCommit}"'`;
    } catch (e) {
      esbuildCmd += ` \\\n      --define:process.env.GIT_COMMIT='"unknown"'`;
    }

    if (includeSourcemaps) {
      esbuildCmd += ' \\\n      --sourcemap=inline \\\n      --source-root=/';
    }

    console.log('Running:', esbuildCmd);
    execSync(esbuildCmd, { 
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1'
      }
    });

    // 3. Create SEA configuration
    console.log('\nCreating SEA configuration...');
    const seaConfig = {
      main: 'build/bundle.js',
      output: 'build/sea-prep.blob',
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false
    };

    fs.writeFileSync('build/sea-config.json', JSON.stringify(seaConfig, null, 2));

    // 4. Generate SEA blob
    console.log('Generating SEA blob...');
    execSync('node --experimental-sea-config build/sea-config.json', { stdio: 'inherit' });

    // 5. Create executable
    console.log('\nCreating executable...');
    const targetExe = process.platform === 'win32' ? 'native/vibetunnel.exe' : 'native/vibetunnel';

    // Copy node binary
    fs.copyFileSync(nodeExe, targetExe);
    if (process.platform !== 'win32') {
      fs.chmodSync(targetExe, 0o755);
    }

    // 6. Inject the blob
    console.log('Injecting SEA blob...');
    let postjectCmd = `npx postject ${targetExe} NODE_SEA_BLOB build/sea-prep.blob \\
      --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`;

    if (process.platform === 'darwin') {
      postjectCmd += ' --macho-segment-name NODE_SEA';
    }

    execSync(postjectCmd, { stdio: 'inherit' });

    // 7. Strip the executable first (before signing)
    console.log('Stripping final executable...');
    execSync(`strip -S ${targetExe} 2>&1 | grep -v "warning: changes being made" || true`, {
      stdio: 'inherit',
      shell: true
    });

    // 8. Sign on macOS (after stripping)
    if (process.platform === 'darwin') {
      console.log('Signing executable...');
      execSync(`codesign --sign - ${targetExe}`, { stdio: 'inherit' });
    }

    // Check final size
    const finalStats = fs.statSync(targetExe);
    console.log(`Final executable size: ${(finalStats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Size reduction: ${((nodeStats.size - finalStats.size) / 1024 / 1024).toFixed(2)} MB`);

    // 9. Copy native modules
    console.log('\nCopying native modules...');
    const nativeModulesDir = 'node_modules/node-pty/build/Release';

    // Check if native modules exist
    if (!fs.existsSync(nativeModulesDir)) {
      console.error(`Error: Native modules directory not found at ${nativeModulesDir}`);
      console.error('This usually means the native module build failed.');
      process.exit(1);
    }

    // Copy pty.node
    const ptyNodePath = path.join(nativeModulesDir, 'pty.node');
    if (!fs.existsSync(ptyNodePath)) {
      console.error('Error: pty.node not found. Native module build may have failed.');
      process.exit(1);
    }
    fs.copyFileSync(ptyNodePath, 'native/pty.node');
    console.log('  - Copied pty.node');

    // Copy spawn-helper (Unix only)
    if (process.platform !== 'win32') {
      const spawnHelperPath = path.join(nativeModulesDir, 'spawn-helper');
      if (!fs.existsSync(spawnHelperPath)) {
        console.error('Error: spawn-helper not found. Native module build may have failed.');
        process.exit(1);
      }
      fs.copyFileSync(spawnHelperPath, 'native/spawn-helper');
      fs.chmodSync('native/spawn-helper', 0o755);
      console.log('  - Copied spawn-helper');
    }

    // Copy authenticate_pam.node
    const authPamPath = 'node_modules/authenticate-pam/build/Release/authenticate_pam.node';
    if (fs.existsSync(authPamPath)) {
      fs.copyFileSync(authPamPath, 'native/authenticate_pam.node');
      console.log('  - Copied authenticate_pam.node');
    } else {
      console.error('Error: authenticate_pam.node not found. PAM authentication is required.');
      process.exit(1);
    }

    console.log('\n✅ Build complete!');
    console.log(`\nPortable executable created in native/ directory:`);
    console.log(`  - vibetunnel (executable)`);
    console.log(`  - pty.node`);
    if (process.platform !== 'win32') {
      console.log(`  - spawn-helper`);
    }
    console.log('\nAll files must be kept together in the same directory.');
    console.log('This bundle will work on any machine with the same OS/architecture.');

  } catch (error) {
    console.error('\n❌ Build failed:', error.message);
    process.exit(1);
  }
}

main();