const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { prodOptions } = require('./esbuild-config.js');

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
  execSync('pnpm exec tailwindcss -i ./src/client/styles.css -o ./public/bundle/styles.css --minify', { stdio: 'inherit' });

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

    // Build screencap bundle
    await esbuild.build({
      ...prodOptions,
      entryPoints: ['src/client/screencap-entry.ts'],
      outfile: 'public/bundle/screencap.js',
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
  execSync('tsc', { stdio: 'inherit' });

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
      external: [
        'node-pty',
        'authenticate-pam',
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


  // Build native executable
  console.log('Building native executable...');

  // Check for --custom-node flag
  const useCustomNode = process.argv.includes('--custom-node');

  if (useCustomNode) {
    console.log('Using custom Node.js for smaller binary size...');
    execSync('node build-native.js --custom-node', { stdio: 'inherit' });
  } else {
    console.log('Using system Node.js...');
    execSync('node build-native.js', { stdio: 'inherit' });
  }

  console.log('Build completed successfully!');
}

// Run the build
build().catch(error => {
  console.error('Build failed:', error);
  process.exit(1);
});