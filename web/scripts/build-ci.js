const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Starting CI build process...');

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
execSync('esbuild src/client/app-entry.ts --bundle --outfile=public/bundle/client-bundle.js --format=esm --minify --define:process.env.NODE_ENV=\'"test"\'', { stdio: 'inherit' });
execSync('esbuild src/client/test-entry.ts --bundle --outfile=public/bundle/test.js --format=esm --minify --define:process.env.NODE_ENV=\'"test"\'', { stdio: 'inherit' });
execSync('esbuild src/client/screencap-entry.ts --bundle --outfile=public/bundle/screencap.js --format=esm --minify --define:process.env.NODE_ENV=\'"test"\'', { stdio: 'inherit' });
execSync('esbuild src/client/sw.ts --bundle --outfile=public/sw.js --format=iife --minify --define:process.env.NODE_ENV=\'"test"\'', { stdio: 'inherit' });

// Build server TypeScript
console.log('Building server...');
execSync('tsc --build tsconfig.server.json', { stdio: 'inherit' });

// Verify dist directory exists
if (fs.existsSync(path.join(__dirname, '../dist'))) {
  const files = fs.readdirSync(path.join(__dirname, '../dist'));
  console.log(`Server build created ${files.length} files in dist/`);
  if (files.length === 0) {
    console.error('WARNING: dist directory is empty after tsc build!');
  }
} else {
  console.error('ERROR: dist directory does not exist after tsc build!');
  process.exit(1);
}

// Skip native executable build in CI
console.log('Skipping native executable build in CI environment...');

console.log('CI build completed successfully!');