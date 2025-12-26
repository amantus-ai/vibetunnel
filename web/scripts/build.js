const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const esbuild = require('esbuild');
const { prodOptions } = require('./esbuild-config.js');
const { nodePtyPlugin } = require('./node-pty-plugin.js');

/**
 * Update HTML files with new hashed asset filenames.
 * @param {string} jsFilename - The hashed JS bundle filename
 * @param {string} cssFilename - The hashed CSS filename
 */
function updateHtmlFiles(jsFilename, cssFilename) {
  const htmlFiles = ['public/index.html', 'public/logs.html'];

  for (const htmlPath of htmlFiles) {
    const fullPath = path.join(__dirname, '..', htmlPath);
    let html = fs.readFileSync(fullPath, 'utf8');

    // Update JS reference (handles both hashed and non-hashed patterns)
    html = html.replace(
      /\/bundle\/client-bundle(-[a-f0-9]{8})?\.js/g,
      `/bundle/${jsFilename}`
    );

    // Update CSS reference (handles both hashed and non-hashed patterns)
    html = html.replace(
      /\/bundle\/styles(-[a-f0-9]{8})?\.css/g,
      `/bundle/${cssFilename}`
    );

    fs.writeFileSync(fullPath, html);
    console.log(`  Updated ${htmlPath}`);
  }
}

async function build() {
  console.log('Starting build process...');
  
  // Validate version sync
  console.log('Validating version sync...');
  execSync('node scripts/validate-version-sync.js', { stdio: 'inherit' });

  // Ensure directories exist
  console.log('Creating directories...');
  execSync('node scripts/ensure-dirs.js', { stdio: 'inherit' });

  // Clean bundle directory before building
  console.log('Cleaning bundle directory...');
  const bundleDir = path.join(__dirname, '..', 'public', 'bundle');
  fs.rmSync(bundleDir, { recursive: true, force: true });
  fs.mkdirSync(bundleDir, { recursive: true });

  // Copy assets
  console.log('Copying assets...');
  execSync('node scripts/copy-assets.js', { stdio: 'inherit' });

  // Build CSS (initially without hash)
  console.log('Building CSS...');
  execSync('npx --no-install postcss ./src/client/styles.css -o ./public/bundle/styles.css', { stdio: 'inherit' });

  // Hash CSS file
  console.log('Hashing CSS...');
  const cssPath = path.join(__dirname, '..', 'public', 'bundle', 'styles.css');
  const cssContent = fs.readFileSync(cssPath);
  const cssHash = crypto.createHash('md5').update(cssContent).digest('hex').slice(0, 8);
  const hashedCssFilename = `styles-${cssHash}.css`;
  fs.renameSync(cssPath, path.join(__dirname, '..', 'public', 'bundle', hashedCssFilename));
  console.log(`  CSS hashed: ${hashedCssFilename}`);

  // Bundle client JavaScript
  console.log('Bundling client JavaScript...');

  let hashedJsFilename = '';

  try {
    // Build main app bundle with content hash
    const result = await esbuild.build({
      ...prodOptions,
      entryPoints: ['src/client/app-entry.ts'],
      outdir: 'public/bundle',
      entryNames: 'client-bundle-[hash]',
      metafile: true,
    });

    // Extract the hashed filename from metafile
    const outputs = Object.keys(result.metafile.outputs);
    const jsOutput = outputs.find(f => f.endsWith('.js') && f.includes('client-bundle'));
    hashedJsFilename = path.basename(jsOutput);
    console.log(`  JS hashed: ${hashedJsFilename}`);

    // Build test bundle (no hash needed for test bundle)
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

  // Update HTML files with hashed filenames
  console.log('Updating HTML files with hashed filenames...');
  updateHtmlFiles(hashedJsFilename, hashedCssFilename);

  // Build server TypeScript
  console.log('Building server...');
  execSync('npx tsc -p tsconfig.server.json', { stdio: 'inherit' });

  // Bundle CLI
  console.log('Bundling CLI...');
  try {
    await esbuild.build({
      entryPoints: ['src/cli.ts'],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      outfile: 'dist/vibetunnel-cli',
      plugins: [nodePtyPlugin],
      external: [
        // 'node-pty', // Removed - handled by plugin
        'authenticate-pam',
        'compression',
        'helmet',
        'express',
        'ghostty-web',
        'ws',
        'jsonwebtoken',
        'web-push',
        'bonjour-service',
        'signal-exit',
        'http-proxy-middleware',
        'multer',
        'mime-types',
      ],
      minify: true,
      sourcemap: false,
      loader: {
        '.ts': 'ts',
        '.js': 'js',
      },
    });
    
    // Read the file and ensure it has exactly one shebang
    let content = fs.readFileSync('dist/vibetunnel-cli', 'utf8');
    
    // Remove any existing shebangs
    content = content.replace(/^#!.*\n/gm, '');
    
    // Add a single shebang at the beginning
    content = '#!/usr/bin/env node\n' + content;
    
    // Write the fixed content back
    fs.writeFileSync('dist/vibetunnel-cli', content);
    
    // Make the CLI executable
    fs.chmodSync('dist/vibetunnel-cli', '755');
    console.log('CLI bundle created successfully');
  } catch (error) {
    console.error('CLI bundling failed:', error);
    process.exit(1);
  }

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
    // Check for --custom-node flag
    const useCustomNode = process.argv.includes('--custom-node');

    if (useCustomNode) {
      console.log('Using custom Node.js for smaller binary size...');
      execSync('node build-native.js --custom-node', { stdio: 'inherit' });
    } else {
      console.log('Using system Node.js...');
      execSync('node build-native.js', { stdio: 'inherit' });
    }
  }

  console.log('Build completed successfully!');
}

// Run the build
build().catch(error => {
  console.error('Build failed:', error);
  process.exit(1);
});
