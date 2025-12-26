#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const webRoot = path.join(__dirname, '..');
const repoRoot = path.join(webRoot, '..');
const zigProjectCandidates = [
  process.env.VT_FWD_SOURCE_DIR,
  path.join(repoRoot, 'native', 'vt-fwd'),
  path.join(webRoot, 'native', 'vt-fwd'),
].filter(Boolean);
const zigProject = zigProjectCandidates.find((candidate) =>
  fs.existsSync(path.join(candidate, 'build.zig')),
);
if (!zigProject) {
  console.error('ERROR: Could not find vt-fwd source directory.');
  console.error('Checked:');
  for (const candidate of zigProjectCandidates) {
    console.error(`  - ${candidate}`);
  }
  console.error(
    'Set VT_FWD_SOURCE_DIR to the vt-fwd directory or ensure native/vt-fwd is available.',
  );
  process.exit(1);
}

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
const zigFromEnv = process.env.ZIG;
const zigCandidates = zigFromEnv
  ? [zigFromEnv]
  : ['/usr/local/bin/zig', '/usr/bin/zig', '/bin/zig'];
const zigBinary =
  zigCandidates.find((candidate) => fs.existsSync(candidate)) ||
  (process.platform === 'win32' ? 'zig.exe' : 'zig');
execFileSync(
  zigBinary,
  ['build', '-Doptimize=ReleaseFast', `-Dversion=${version}`],
  {
    cwd: zigProject,
    stdio: 'inherit',
  },
);

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
