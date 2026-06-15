const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { prodOptions } = require('./esbuild-config.js');
const { buildCli } = require('./build-cli.js');
const { getCustomNodeBuildArgs } = require('./custom-node-args.js');

async function build() {
  console.log('Starting build process...');
  
  // Validate version sync
  console.log('Validating version sync...');
  execSync('node scripts/validate-version-sync.js', { stdio: 'inherit' });

  // Ensure directories exist
  console.log('Creating directories...');
  execSync('node scripts/ensure-dirs.js', { stdio: 'inherit' });

  // Copy assets
  console.log('Copying assets...');
  execSync('node scripts/copy-assets.js', { stdio: 'inherit' });

  // Build CSS
  console.log('Building CSS...');
  execSync('npx --no-install postcss ./src/client/styles.css -o ./public/bundle/styles.css', { stdio: 'inherit' });

  // Bundle client JavaScript
  console.log('Bundling client JavaScript...');

  try {
    // Build main app bundle
    await esbuild.build({
      ...prodOptions,
      entryPoints: ['src/client/app-entry.ts'],
      outfile: 'public/bundle/client-bundle.js',
    });

    // Build test bundle
    await esbuild.build({
      ...prodOptions,
      entryPoints: ['src/client/test-entry.ts'],
      outfile: 'public/bundle/test.js',
    });


    // Build service worker
    await esbuild.build({
      ...prodOptions,
      entryPoints: ['src/client/sw.ts'],
      outfile: 'public/sw.js',
      format: 'iife', // Service workers need IIFE format
    });

    console.log('Client bundles built successfully');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }

  // Build server TypeScript
  console.log('Building server...');
  execSync('npx tsc -p tsconfig.server.json', { stdio: 'inherit' });

  await buildCli();

  // Build zig forwarder first.
  // `build-native.js` runs verification in CI which expects the forwarder to exist.
  console.log('Building zig forwarder...');
  execSync('node scripts/build-fwd-zig.js', { stdio: 'inherit' });


  const shouldBuildSea =
    process.env.VIBETUNNEL_BUILD_SEA === '1' ||
    process.env.VIBETUNNEL_SEA === '1' ||
    process.env.VIBETUNNEL_SEA === 'true' ||
    process.argv.includes('--build-sea');
  const isLinux = process.platform === 'linux';
  if (isLinux && !shouldBuildSea) {
    console.log('Skipping native SEA build on Linux (set VIBETUNNEL_BUILD_SEA=1 or --build-sea to override).');
    console.log('Build completed successfully!');
    return;
  }

  // Build native executable
  console.log('Building native executable...');

  // Check if native binaries already exist (skip build for development)
  const nativeDir = path.join(__dirname, '..', 'native');
  const vibetunnelPath = path.join(nativeDir, 'vibetunnel');
  const ptyNodePath = path.join(nativeDir, 'pty.node');
  const spawnHelperPath = path.join(nativeDir, 'spawn-helper');

  if (fs.existsSync(vibetunnelPath) && fs.existsSync(ptyNodePath) && fs.existsSync(spawnHelperPath)) {
    console.log('✅ Native binaries already exist, skipping build...');
    console.log('  - vibetunnel executable: ✓');
    console.log('  - pty.node: ✓');
    console.log('  - spawn-helper: ✓');
  } else {
    const customNodeArgs = getCustomNodeBuildArgs(process.argv);

    if (customNodeArgs) {
      console.log('Using custom Node.js for smaller binary size...');
      execFileSync(process.execPath, ['build-native.js', ...customNodeArgs], { stdio: 'inherit' });
    } else {
      console.log('Using system Node.js...');
      execFileSync(process.execPath, ['build-native.js'], { stdio: 'inherit' });
    }
  }

  console.log('Build completed successfully!');
}

// Run the build
build().catch(error => {
  console.error('Build failed:', error);
  process.exit(1);
});
