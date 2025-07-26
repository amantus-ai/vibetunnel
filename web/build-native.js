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
 * node build-native.js --custom-node      # Auto-discover custom Node.js (uses most recent)
 * node build-native.js --custom-node=/path/to/node  # Use specific custom Node.js binary
 * node build-native.js --custom-node /path/to/node  # Alternative syntax
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
  } else if (arg === '--custom-node') {
    if (i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) {
      // Next argument is the path
      customNodePath = process.argv[i + 1];
    } else {
      // No path provided, use auto-discovery
      customNodePath = 'auto';
    }
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

// No patching needed - SEA support is built into our vendored node-pty

async function main() {
  try {
    // No patching needed - SEA support is built into our vendored node-pty
    console.log('Using vendored node-pty with built-in SEA support...');
    
    // Ensure native modules are built (in case postinstall didn't run)
    const nativePtyDir = 'node_modules/node-pty/build/Release';
    const nativeAuthDir = 'node_modules/authenticate-pam/build/Release';
    
    if (!fs.existsSync(nativePtyDir)) {
      console.log('Building node-pty native module...');
      // Find the actual node-pty path (could be in .pnpm directory)
      const nodePtyPath = require.resolve('node-pty/package.json');
      const nodePtyDir = path.dirname(nodePtyPath);
      console.log(`Found node-pty at: ${nodePtyDir}`);
      
      // Build node-pty using node-gyp directly to avoid TypeScript compilation
      execSync(`cd "${nodePtyDir}" && npx node-gyp rebuild`, { 
        stdio: 'inherit',
        shell: true
      });
    }
    
    if (!fs.existsSync(nativeAuthDir)) {
      console.log('Building authenticate-pam native module...');
      execSync('npm rebuild authenticate-pam', { 
        stdio: 'inherit',
        cwd: __dirname
      });
    }
    
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
      if (customNodePath === 'auto') {
        // Auto-discover custom Node.js build
        const buildDir = path.join(__dirname, '.node-builds');
        if (fs.existsSync(buildDir)) {
          // Find the most recent custom Node.js build
          const builds = fs.readdirSync(buildDir)
            .filter(name => name.startsWith('node-v') && name.endsWith('-minimal'))
            .map(name => {
              const nodePath = path.join(buildDir, name, 'out', 'Release', 'node');
              if (fs.existsSync(nodePath)) {
                const match = name.match(/node-v(.+)-minimal/);
                if (!match || !match[1]) {
                  console.warn(`Warning: Skipping directory with invalid name format: ${name}`);
                  return null;
                }
                return {
                  path: nodePath,
                  version: match[1],
                  mtime: fs.statSync(nodePath).mtime
                };
              }
              return null;
            })
            .filter(Boolean)
            .sort((a, b) => b.mtime - a.mtime);
          
          if (builds.length > 0) {
            customNodePath = builds[0].path;
            console.log(`Auto-discovered custom Node.js v${builds[0].version} at ${customNodePath}`);
          } else {
            console.error('Error: No custom Node.js builds found in .node-builds/');
            console.error('Build one using: node build-custom-node.js');
            process.exit(1);
          }
        } else {
          console.error('Error: No .node-builds directory found');
          console.error('Build a custom Node.js using: node build-custom-node.js');
          process.exit(1);
        }
      } else {
        // Validate custom node exists at specified path
        if (!fs.existsSync(customNodePath)) {
          console.error(`Error: Custom Node.js not found at ${customNodePath}`);
          console.error('Build one using: node build-custom-node.js');
          process.exit(1);
        }
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
      
      // Save original PATH and use clean environment
      const originalPath = process.env.PATH;
      const cleanEnv = {
        ...process.env,
        // Use only system paths to avoid Homebrew contamination
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        npm_config_runtime: 'node',
        npm_config_target: customVersion.substring(1), // Remove 'v' prefix
        npm_config_arch: process.arch,
        npm_config_target_arch: process.arch,
        npm_config_disturl: 'https://nodejs.org/dist',
        npm_config_build_from_source: 'true',
        // Node.js 24 requires C++20
        CXXFLAGS: '-std=c++20',
        npm_config_cxxflags: '-std=c++20'
      };
      
      // Remove any Homebrew-related environment variables
      delete cleanEnv.LDFLAGS;
      delete cleanEnv.LIBRARY_PATH;
      delete cleanEnv.CPATH;
      delete cleanEnv.C_INCLUDE_PATH;
      delete cleanEnv.CPLUS_INCLUDE_PATH;
      delete cleanEnv.PKG_CONFIG_PATH;
      
      console.log('Using clean PATH to avoid Homebrew dependencies during native module rebuild...');
      
      execSync(`pnpm rebuild node-pty authenticate-pam`, {
        stdio: 'inherit',
        env: cleanEnv
      });
      
      // Restore original PATH
      process.env.PATH = originalPath;
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
      --external:../build/Release/pty.node \\
      --external:./build/Release/pty.node \\
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

    // 2b. Post-process bundle to ensure VIBETUNNEL_SEA is properly set
    console.log('\nPost-processing bundle for SEA compatibility...');
    let bundleContent = fs.readFileSync('build/bundle.js', 'utf8');
    
    // Remove shebang line if present (not valid in SEA bundles)
    if (bundleContent.startsWith('#!')) {
      bundleContent = bundleContent.substring(bundleContent.indexOf('\n') + 1);
    }
    
    // Add VIBETUNNEL_SEA environment variable at the top of the bundle
    // This ensures the patched node-pty knows it's running in SEA mode
    const seaEnvSetup = `// Set VIBETUNNEL_SEA environment variable for SEA mode
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
  process.env.VIBETUNNEL_SEA = 'true';
}

`;
    
    bundleContent = seaEnvSetup + bundleContent;
    
    fs.writeFileSync('build/bundle.js', bundleContent);
    console.log('Bundle post-processing complete');

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
    try {
      execSync(`strip -S ${targetExe} 2>&1 | grep -v "warning: changes being made" || true`, {
        stdio: 'inherit',
        shell: true
      });
    } catch (error) {
      console.warn('Strip command had warnings (this is normal):', error.message);
    }

    // Ensure executable permissions after stripping
    if (process.platform !== 'win32') {
      fs.chmodSync(targetExe, 0o755);
    }
    
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
    
    // Find the actual node-pty build directory (could be in .pnpm directory)
    const nodePtyPath = require.resolve('node-pty/package.json');
    const nodePtyBaseDir = path.dirname(nodePtyPath);
    const nativeModulesDir = path.join(nodePtyBaseDir, 'build/Release');

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

    // Copy spawn-helper (macOS only)
    // Note: spawn-helper is only built and required on macOS where it's used for pty_posix_spawn()
    // On Linux, node-pty uses forkpty() directly and doesn't need spawn-helper
    if (process.platform === 'darwin') {
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
    if (process.platform === 'darwin') {
      console.log(`  - spawn-helper`);
    }
    console.log(`  - authenticate_pam.node`);
    console.log('\nAll files must be kept together in the same directory.');
    console.log('This bundle will work on any machine with the same OS/architecture.');
    
    // Verify the executable works
    if (process.env.CI || process.argv.includes('--verify')) {
      console.log('\nVerifying native executable...');
      try {
        execSync('node scripts/verify-native.js', { stdio: 'inherit', cwd: __dirname });
      } catch (error) {
        console.error('Native executable verification failed!');
        process.exit(1);
      }
    }

  } catch (error) {
    console.error('\n❌ Build failed:', error.message);
    process.exit(1);
  }
}

main();