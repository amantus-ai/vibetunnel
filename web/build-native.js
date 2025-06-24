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
 * ## How it works
 *
 * 1. **Patches node-pty** to work with SEA's limitations:
 *    - SEA's require() can only load built-in Node.js modules, not external files
 *    - We patch node-pty to use `process.dlopen()` instead of `require()` for native modules
 *    - All file lookups are changed to look next to the executable, not in node_modules
 *
 * 2. **Bundles TypeScript** using esbuild:
 *    - Compiles and bundles all TypeScript/JavaScript into a single file
 *    - Includes inline sourcemaps for better debugging
 *    - Source map support can be enabled with --sourcemap flag
 *
 * 3. **Creates SEA blob**:
 *    - Uses Node.js's experimental SEA config to generate a blob from the bundle
 *    - The blob contains all the JavaScript code and can be injected into a Node binary
 *
 * 4. **Injects into Node.js binary**:
 *    - Copies the Node.js executable and injects the SEA blob using postject
 *    - Signs the binary on macOS to avoid security warnings
 *
 * ## Portability
 * The resulting executable is fully portable:
 * - No absolute paths are embedded
 * - Native modules are loaded relative to the executable location
 * - Can be moved to any directory or machine with the same OS/architecture
 *
 * ## Usage
 * ```bash
 * node build-native.js                    # Build with system Node.js
 * node build-native.js --sourcemap        # Build with inline sourcemaps
 * node build-native.js --custom-node=/path/to/node  # Use custom Node.js binary
 *
 * # Build custom Node.js first:
 * node build-custom-node.js               # Build minimal Node.js for current version
 * node build-custom-node.js --version=24.2.0  # Build specific version
 * ```
 *
 * ## Requirements
 * - Node.js 20+ (for SEA support)
 * - postject (installed automatically if needed)
 *
 * ## Known Limitations
 * - The SEA warning about require() limitations is expected and harmless
 * - Native modules must be distributed alongside the executable
 * - Cross-platform builds are not supported (build on the target platform)
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
    // Check if next argument is a path
    if (i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) {
      customNodePath = process.argv[i + 1];
    } else {
      // No path provided, search for custom Node.js build
      console.log('Searching for custom Node.js build...');
      const customBuildsDir = path.join(__dirname, '.node-builds');
      if (fs.existsSync(customBuildsDir)) {
        const dirs = fs.readdirSync(customBuildsDir)
          .filter(dir => dir.startsWith('node-v') && dir.endsWith('-minimal'))
          .map(dir => ({
            name: dir,
            path: path.join(customBuildsDir, dir, 'out/Release/node'),
            mtime: fs.statSync(path.join(customBuildsDir, dir)).mtime
          }))
          .filter(item => fs.existsSync(item.path))
          .sort((a, b) => b.mtime - a.mtime); // Sort by modification time, newest first

        if (dirs.length > 0) {
          customNodePath = dirs[0].path;
          console.log(`Found custom Node.js at: ${customNodePath}`);
        } else {
          console.log('No custom Node.js builds found in .node-builds/');
        }
      }
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

// Helper function to check if modules need rebuild
function getNodeABI(nodePath) {
  try {
    const version = execSync(`"${nodePath}" --version`, { encoding: 'utf8' }).trim();
    // Extract major version for ABI compatibility check
    const major = parseInt(version.split('.')[0].substring(1));
    return { version, major };
  } catch (e) {
    return null;
  }
}

function checkNativeModulesExist() {
  // Check multiple possible locations for native modules
  const ptyLocations = [
    'node_modules/@homebridge/node-pty-prebuilt-multiarch/build/Release/pty.node',
    `node_modules/@homebridge/node-pty-prebuilt-multiarch/prebuilds/${process.platform}-${process.arch}/pty.node`,
    `node_modules/@homebridge/node-pty-prebuilt-multiarch/prebuilds/${process.platform}-${process.arch}/node-pty.node`
  ];
  
  const spawnHelperLocations = [
    'node_modules/@homebridge/node-pty-prebuilt-multiarch/build/Release/spawn-helper',
    'node_modules/@homebridge/node-pty-prebuilt-multiarch/lib/binding/Release/spawn-helper',
    'node_modules/@homebridge/node-pty-prebuilt-multiarch/spawn-helper'
  ];
  
  const pamLocations = [
    'node_modules/authenticate-pam/build/Release/authenticate_pam.node',
    'node_modules/authenticate-pam/lib/binding/Release/authenticate_pam.node',
    `node_modules/authenticate-pam/prebuilds/${process.platform}-${process.arch}/authenticate_pam.node`
  ];
  
  const ptyExists = ptyLocations.some(loc => fs.existsSync(path.join(__dirname, loc)));
  const spawnHelperExists = process.platform === 'win32' || spawnHelperLocations.some(loc => fs.existsSync(path.join(__dirname, loc)));
  const pamExists = pamLocations.some(loc => fs.existsSync(path.join(__dirname, loc)));
  
  if (!ptyExists) console.log('Missing native module: pty.node');
  if (!spawnHelperExists) console.log('Missing native module: spawn-helper');
  if (!pamExists) console.log('Missing native module: authenticate_pam.node');
  
  return ptyExists && spawnHelperExists && pamExists;
}

function isNodePtyPatched() {
  const loaderPath = path.join(__dirname, 'node_modules/@homebridge/node-pty-prebuilt-multiarch/lib/prebuild-loader.js');
  if (!fs.existsSync(loaderPath)) return false;
  
  const content = fs.readFileSync(loaderPath, 'utf8');
  return content.includes('Custom loader for SEA');
}

function patchNodePty() {
  console.log('Preparing node-pty for SEA build...');

  const needsRebuild = customNodePath !== null;
  const modulesExist = checkNativeModulesExist();
  const alreadyPatched = isNodePtyPatched();
  
  // Determine if we need to do anything
  if (!needsRebuild && modulesExist && alreadyPatched) {
    console.log('✓ Native modules exist and are already patched for SEA, skipping preparation');
    return;
  }

  // Check ABI compatibility if using custom Node.js
  let abiMismatch = false;
  if (customNodePath) {
    const customABI = getNodeABI(customNodePath);
    const systemABI = getNodeABI(process.execPath);
    
    if (customABI && systemABI) {
      abiMismatch = customABI.major !== systemABI.major;
      console.log(`Custom Node.js: ${customABI.version} (ABI v${customABI.major})`);
      console.log(`System Node.js: ${systemABI.version} (ABI v${systemABI.major})`);
      
      if (!abiMismatch) {
        console.log('✓ ABI versions match, rebuild may not be necessary');
      } else {
        console.log('⚠️  ABI versions differ, rebuild required');
      }
    }
  }

  // Only reinstall/rebuild if necessary
  if (!modulesExist || (customNodePath && abiMismatch)) {
    if (!modulesExist) {
      console.log('Native modules missing, installing...');
      
      // Ensure node_modules exists and has proper modules
      if (!fs.existsSync('node_modules/@homebridge/node-pty-prebuilt-multiarch') || 
          !fs.existsSync('node_modules/authenticate-pam')) {
        console.log('Installing missing native modules...');
        execSync('pnpm install --silent', { stdio: 'inherit' });
      }
      
      // After install, check if native modules were built
      if (!checkNativeModulesExist()) {
        console.log('Native modules need to be built...');
        // Force rebuild
        execSync('pnpm rebuild @homebridge/node-pty-prebuilt-multiarch authenticate-pam', {
          stdio: 'inherit',
          env: {
            ...process.env,
            npm_config_build_from_source: 'true'
          }
        });
      }
    }
    
    if (customNodePath && abiMismatch) {
      console.log('Rebuilding native modules for custom Node.js ABI...');
      
      const customVersion = getNodeABI(customNodePath).version;
      
      try {
        // Rebuild both modules for the custom Node.js version
        execSync(`pnpm rebuild @homebridge/node-pty-prebuilt-multiarch authenticate-pam`, {
          stdio: 'inherit',
          env: {
            ...process.env,
            npm_config_runtime: 'node',
            npm_config_target: customVersion.substring(1), // Remove 'v' prefix
            npm_config_arch: process.arch,
            npm_config_target_arch: process.arch,
            npm_config_disturl: 'https://nodejs.org/dist',
            npm_config_build_from_source: 'true',
            CXXFLAGS: '-std=c++20 -stdlib=libc++ -mmacosx-version-min=14.0',
            MACOSX_DEPLOYMENT_TARGET: '14.0'
          }
        });
        console.log('✓ Native modules rebuilt successfully');
      } catch (error) {
        console.error('Failed to rebuild native modules:', error.message);
        process.exit(1);
      }
    }
  }

  // Only patch if not already patched
  if (alreadyPatched) {
    console.log('✓ node-pty already patched for SEA, skipping patch step');
    return;
  }

  console.log('Patching node-pty for SEA build...');

  // Patch prebuild-loader.js to use process.dlopen instead of require
  const prebuildLoaderFile = path.join(__dirname, 'node_modules/@homebridge/node-pty-prebuilt-multiarch/lib/prebuild-loader.js');
  const prebuildLoaderContent = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var path = require("path");
var fs = require("fs");

// Custom loader for SEA that uses process.dlopen
var pty;

// Helper function to load native module using dlopen
function loadNativeModule(modulePath) {
  const module = { exports: {} };
  process.dlopen(module, modulePath);
  return module.exports;
}

// Determine the path to pty.node
function getPtyPath() {
  const execDir = path.dirname(process.execPath);
  // Look for pty.node next to the executable first
  const ptyPath = path.join(execDir, 'pty.node');

  if (fs.existsSync(ptyPath)) {
    return ptyPath;
  }

  // If not found, throw error with helpful message
  throw new Error('Could not find pty.node next to executable at: ' + ptyPath);
}

try {
  const ptyPath = getPtyPath();

  // Set spawn-helper path for Unix systems
  if (process.platform !== 'win32') {
    const execDir = path.dirname(process.execPath);
    const spawnHelperPath = path.join(execDir, 'spawn-helper');
    if (fs.existsSync(spawnHelperPath)) {
      process.env.NODE_PTY_SPAWN_HELPER_PATH = spawnHelperPath;
    }
  }

  pty = loadNativeModule(ptyPath);
} catch (error) {
  console.error('Failed to load pty.node:', error);
  throw error;
}

exports.default = pty;
//# sourceMappingURL=prebuild-loader.js.map`;

  fs.writeFileSync(prebuildLoaderFile, prebuildLoaderContent);

  // Also patch windowsPtyAgent.js if it exists
  const windowsPtyAgentFile = path.join(__dirname, 'node_modules/@homebridge/node-pty-prebuilt-multiarch/lib/windowsPtyAgent.js');
  if (fs.existsSync(windowsPtyAgentFile)) {
    let content = fs.readFileSync(windowsPtyAgentFile, 'utf8');
    // Replace direct require of .node files with our loader
    content = content.replace(
      /require\(['"]\.\.\/build\/Release\/pty\.node['"]\)/g,
      "require('./prebuild-loader').default"
    );
    fs.writeFileSync(windowsPtyAgentFile, content);
  }

  // Patch index.js exports.native line
  const indexFile = path.join(__dirname, 'node_modules/@homebridge/node-pty-prebuilt-multiarch/lib/index.js');
  if (fs.existsSync(indexFile)) {
    let content = fs.readFileSync(indexFile, 'utf8');
    // Replace the exports.native line that directly requires .node
    content = content.replace(
      /exports\.native = \(process\.platform !== 'win32' \? require\(prebuild_file_path_1\.ptyPath \|\| '\.\.\/build\/Release\/pty\.node'\) : null\);/,
      "exports.native = (process.platform !== 'win32' ? require('./prebuild-loader').default : null);"
    );
    fs.writeFileSync(indexFile, content);
  }

  // Patch unixTerminal.js to fix spawn-helper path resolution
  const unixTerminalFile = path.join(__dirname, 'node_modules/@homebridge/node-pty-prebuilt-multiarch/lib/unixTerminal.js');
  if (fs.existsSync(unixTerminalFile)) {
    let content = fs.readFileSync(unixTerminalFile, 'utf8');
    
    // Check if already patched (contains our SEA comment)
    if (content.includes('// For SEA, use spawn-helper from environment')) {
      console.log('unixTerminal.js already patched, skipping...');
    } else {
      // Find where helperPath is defined
      const helperPathMatch = content.match(/var helperPath[^;]*;/);
      if (!helperPathMatch) {
        console.log('Warning: Could not find helperPath declaration in unixTerminal.js');
      } else {
        // Find the position right after var helperPath;
        const insertPosition = content.indexOf(helperPathMatch[0]) + helperPathMatch[0].length;
        
        // Insert our patch
        const helperPathPatch = `
// For SEA, use spawn-helper from environment or next to executable
if (process.env.NODE_PTY_SPAWN_HELPER_PATH) {
  helperPath = process.env.NODE_PTY_SPAWN_HELPER_PATH;
} else {
  // In SEA context, look next to the executable
  const execDir = path.dirname(process.execPath);
  const spawnHelperPath = path.join(execDir, 'spawn-helper');
  if (require('fs').existsSync(spawnHelperPath)) {
    helperPath = spawnHelperPath;
  } else {
    // Fallback to original logic
    helperPath = '../build/Release/spawn-helper';
    helperPath = path.resolve(__dirname, helperPath);
    helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');
    helperPath = helperPath.replace('node_modules.asar', 'node_modules.asar.unpacked');
  }
}`;
        
        // Insert the patch after the helperPath declaration
        content = content.substring(0, insertPosition) + helperPathPatch + content.substring(insertPosition);
        
        fs.writeFileSync(unixTerminalFile, content);
      }
    }
  }

  console.log('Patched node-pty to use process.dlopen() instead of require().');
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

    // Get version of the Node.js we're using
    if (customNodePath) {
      try {
        const customVersion = execSync(`"${nodeExe}" --version`, { encoding: 'utf8' }).trim();
        console.log(`Custom Node.js version: ${customVersion}`);
        console.log('This minimal build excludes intl, npm, inspector, and other unused features.');
      } catch (e) {
        console.log('Could not determine custom Node.js version');
      }
    }

    // 1. Patch node-pty
    patchNodePty();

    // 2. Bundle TypeScript with esbuild using custom loader
    console.log('\nBundling TypeScript with esbuild...');
    const buildDate = new Date().toISOString();
    const buildTimestamp = Date.now();

    // Use esbuild directly without custom loader since we're patching node-pty
    let esbuildCmd = `npx esbuild src/cli.ts \\
      --bundle \\
      --platform=node \\
      --target=node20 \\
      --outfile=build/bundle.js \\
      --format=cjs \\
      --keep-names \\
      --external:authenticate-pam \\
      --define:process.env.BUILD_DATE='"${buildDate}"' \\
      --define:process.env.BUILD_TIMESTAMP='"${buildTimestamp}"'`;

    if (includeSourcemaps) {
      esbuildCmd += ' \\\n      --sourcemap=inline \\\n      --source-root=/';
    }

    console.log('Running:', esbuildCmd);
    execSync(esbuildCmd, { stdio: 'inherit' });

    // 2. Create SEA configuration
    console.log('\nCreating SEA configuration...');
    const seaConfig = {
      main: 'build/bundle.js',
      output: 'build/sea-prep.blob',
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false
    };

    fs.writeFileSync('build/sea-config.json', JSON.stringify(seaConfig, null, 2));

    // 3. Generate SEA blob
    console.log('Generating SEA blob...');
    execSync('node --experimental-sea-config build/sea-config.json', { stdio: 'inherit' });

    // 4. Create executable
    console.log('\nCreating executable...');
    const targetExe = process.platform === 'win32' ? 'native/vibetunnel.exe' : 'native/vibetunnel';

    // Copy node binary
    fs.copyFileSync(nodeExe, targetExe);
    if (process.platform !== 'win32') {
      fs.chmodSync(targetExe, 0o755);
    }

    // 5. Inject the blob
    console.log('Injecting SEA blob...');
    let postjectCmd = `npx postject ${targetExe} NODE_SEA_BLOB build/sea-prep.blob \\
      --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`;

    if (process.platform === 'darwin') {
      postjectCmd += ' --macho-segment-name NODE_SEA';
    }

    execSync(postjectCmd, { stdio: 'inherit' });

    // 6. Strip the executable first (before signing)
    console.log('Stripping final executable...');
    // Note: This will show a warning about invalidating code signature, which is expected
    // since we're modifying a signed Node.js binary. We'll re-sign it in the next step.
    execSync(`strip -S ${targetExe} 2>&1 | grep -v "warning: changes being made" || true`, {
      stdio: 'inherit',
      shell: true
    });

    // 7. Sign on macOS (after stripping)
    if (process.platform === 'darwin') {
      console.log('Signing executable...');
      execSync(`codesign --sign - ${targetExe}`, { stdio: 'inherit' });
    }

    // Check final size
    const finalStats = fs.statSync(targetExe);
    console.log(`Final executable size: ${(finalStats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Size reduction: ${((nodeStats.size - finalStats.size) / 1024 / 1024).toFixed(2)} MB`);

    // 8. Copy native modules BEFORE restoring (to preserve custom-built versions)
    console.log('Copying native modules...');
    const nativeModulesDir = 'node_modules/@homebridge/node-pty-prebuilt-multiarch/build/Release';

    // Debug: List what's in the module directory
    const ptyModuleDir = 'node_modules/@homebridge/node-pty-prebuilt-multiarch';
    if (fs.existsSync(ptyModuleDir)) {
      console.log('node-pty module directory structure:');
      try {
        execSync(`find ${ptyModuleDir} -name "*.node" -o -name "spawn-helper" | head -20`, { stdio: 'inherit' });
      } catch (e) {
        // Fallback for Windows or if find command fails
        console.log('Could not list directory structure');
      }
    }

    // Check if native modules exist
    if (!fs.existsSync(nativeModulesDir)) {
      console.error(`Error: Native modules directory not found at ${nativeModulesDir}`);
      console.error('Attempting to rebuild native modules...');
      
      // Try to rebuild the native modules
      try {
        console.log('Removing and reinstalling @homebridge/node-pty-prebuilt-multiarch...');
        execSync('rm -rf node_modules/@homebridge/node-pty-prebuilt-multiarch', { stdio: 'inherit' });
        execSync('pnpm install @homebridge/node-pty-prebuilt-multiarch --force', { stdio: 'inherit' });
        
        // Check again
        if (!fs.existsSync(nativeModulesDir)) {
          console.error('Native module rebuild failed. Checking for prebuilt binaries...');
          
          // Check for prebuilt binaries in alternative locations
          const prebuildDir = 'node_modules/@homebridge/node-pty-prebuilt-multiarch/prebuilds';
          if (fs.existsSync(prebuildDir)) {
            console.log('Found prebuilds directory, listing contents:');
            execSync(`ls -la ${prebuildDir}`, { stdio: 'inherit' });
          }
          
          throw new Error('Native modules still not found after rebuild attempt');
        }
      } catch (e) {
        console.error('Failed to rebuild native modules:', e.message);
        process.exit(1);
      }
    }

    // Function to find and copy native modules
    function findAndCopyNativeModules() {
      // First try the build directory
      const ptyNodePath = path.join(nativeModulesDir, 'pty.node');
      const spawnHelperPath = path.join(nativeModulesDir, 'spawn-helper');
      
      if (fs.existsSync(ptyNodePath)) {
        fs.copyFileSync(ptyNodePath, 'native/pty.node');
        console.log('  - Copied pty.node from build directory');
      } else {
        // Try to find prebuilt binary
        const modulePath = 'node_modules/@homebridge/node-pty-prebuilt-multiarch';
        const platform = process.platform;
        const arch = process.arch;
        
        // Common prebuilt locations
        const prebuiltPaths = [
          path.join(modulePath, `prebuilds/${platform}-${arch}/pty.node`),
          path.join(modulePath, `prebuilds/${platform}-${arch}/node-pty.node`),
          path.join(modulePath, `lib/binding/Release/pty.node`),
          path.join(modulePath, `lib/binding/Release/node-pty.node`)
        ];
        
        let found = false;
        for (const prebuildPath of prebuiltPaths) {
          if (fs.existsSync(prebuildPath)) {
            fs.copyFileSync(prebuildPath, 'native/pty.node');
            console.log(`  - Copied pty.node from prebuilt: ${prebuildPath}`);
            found = true;
            break;
          }
        }
        
        if (!found) {
          console.error('Error: pty.node not found in any expected location');
          console.error('Searched locations:', prebuiltPaths);
          process.exit(1);
        }
      }
      
      // Copy spawn-helper (Unix only)
      if (process.platform !== 'win32') {
        if (fs.existsSync(spawnHelperPath)) {
          fs.copyFileSync(spawnHelperPath, 'native/spawn-helper');
          fs.chmodSync('native/spawn-helper', 0o755);
          console.log('  - Copied spawn-helper from build directory');
        } else {
          // Try to find prebuilt spawn-helper
          const modulePath = 'node_modules/@homebridge/node-pty-prebuilt-multiarch';
          const spawnHelperPaths = [
            path.join(modulePath, 'lib/binding/Release/spawn-helper'),
            path.join(modulePath, 'prebuilds/spawn-helper'),
            path.join(modulePath, 'spawn-helper')
          ];
          
          let found = false;
          for (const helperPath of spawnHelperPaths) {
            if (fs.existsSync(helperPath)) {
              fs.copyFileSync(helperPath, 'native/spawn-helper');
              fs.chmodSync('native/spawn-helper', 0o755);
              console.log(`  - Copied spawn-helper from: ${helperPath}`);
              found = true;
              break;
            }
          }
          
          if (!found) {
            console.error('Error: spawn-helper not found in any expected location');
            console.error('Searched locations:', spawnHelperPaths);
            process.exit(1);
          }
        }
      }
    }
    
    // Copy native modules
    findAndCopyNativeModules();

    // Copy authenticate_pam.node (REQUIRED)
    const authPamPaths = [
      'node_modules/authenticate-pam/build/Release/authenticate_pam.node',
      'node_modules/authenticate-pam/lib/binding/Release/authenticate_pam.node',
      'node_modules/authenticate-pam/prebuilds/darwin-arm64/authenticate_pam.node',
      'node_modules/authenticate-pam/prebuilds/darwin-x64/authenticate_pam.node'
    ];
    
    let pamFound = false;
    for (const authPamPath of authPamPaths) {
      if (fs.existsSync(authPamPath)) {
        fs.copyFileSync(authPamPath, 'native/authenticate_pam.node');
        console.log(`  - Copied authenticate_pam.node from: ${authPamPath}`);
        pamFound = true;
        break;
      }
    }
    
    if (!pamFound) {
      console.error('Error: authenticate_pam.node not found.');
      console.error('Searched locations:', authPamPaths);
      console.error('This should have been built by patchNodePty() function.');
      process.exit(1);
    }

    // No need to restore - the patched version works fine for development too

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