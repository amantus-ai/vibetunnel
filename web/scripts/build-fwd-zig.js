#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const webRoot = path.join(__dirname, '..');
const repoRoot = path.join(webRoot, '..');
const zigProject = path.join(repoRoot, 'native', 'vt-fwd');

const pkgPath = path.join(webRoot, 'package.json');
const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : {};
const version = pkg.version || 'unknown';

const zigOut = path.join(zigProject, 'zig-out', 'bin', 'vibetunnel-fwd');
const nativeOutDir = path.join(webRoot, 'native');
const binOutDir = path.join(webRoot, 'bin');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

console.log('Building zig forwarder...');
execSync(`zig build -Doptimize=ReleaseFast -Dversion=${version}`, {
  cwd: zigProject,
  stdio: 'inherit',
});

if (!fs.existsSync(zigOut)) {
  console.error('ERROR: zig build did not produce vibetunnel-fwd binary');
  process.exit(1);
}

ensureDir(nativeOutDir);
ensureDir(binOutDir);

const nativeDest = path.join(nativeOutDir, 'vibetunnel-fwd');
const binDest = path.join(binOutDir, 'vibetunnel-fwd');

fs.copyFileSync(zigOut, nativeDest);
fs.copyFileSync(zigOut, binDest);
fs.chmodSync(nativeDest, 0o755);
fs.chmodSync(binDest, 0o755);

console.log(`✓ zig forwarder built: ${path.relative(repoRoot, nativeDest)}`);
console.log(`✓ zig forwarder installed: ${path.relative(repoRoot, binDest)}`);
