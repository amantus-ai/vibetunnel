#!/usr/bin/env node

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const webRoot = path.join(__dirname, '..');
const repoRoot = path.join(webRoot, '..');
const rustProjectCandidates = [
  process.env.VT_FWD_SOURCE_DIR,
  path.join(repoRoot, 'native', 'vt-fwd'),
  path.join(webRoot, 'native', 'vt-fwd'),
].filter(Boolean);
const rustProject = rustProjectCandidates.find((candidate) =>
  fs.existsSync(path.join(candidate, 'Cargo.toml'))
);
if (!rustProject) {
  console.error('ERROR: Could not find vt-fwd source directory.');
  console.error('Checked:');
  for (const candidate of rustProjectCandidates) {
    console.error(`  - ${candidate}`);
  }
  console.error(
    'Set VT_FWD_SOURCE_DIR to the vt-fwd directory or ensure native/vt-fwd is available.'
  );
  process.exit(1);
}

const pkgPath = path.join(webRoot, 'package.json');
const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : {};
const version = process.env.VIBETUNNEL_VERSION || pkg.version || 'unknown';
const toolchainPath = path.join(rustProject, 'rust-toolchain.toml');
const toolchain = fs.existsSync(toolchainPath) ? fs.readFileSync(toolchainPath, 'utf8') : '';
const requiredRustVersion = toolchain.match(/^channel\s*=\s*"([^"]+)"/m)?.[1];
if (!requiredRustVersion) {
  console.error(`ERROR: Missing pinned Rust channel in ${toolchainPath}.`);
  process.exit(1);
}

const nativeOutDir = path.join(webRoot, 'native');
const binOutDir = path.join(webRoot, 'bin');
const args = process.argv.slice(2);

function getArgValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}

const target = getArgValue('--target');
const output = getArgValue('--output');
const nativeArch = getArgValue('--native-arch');
if (
  (args.includes('--target') && !target) ||
  (args.includes('--output') && !output) ||
  (args.includes('--native-arch') && !nativeArch)
) {
  console.error('ERROR: --target, --native-arch, and --output require values.');
  process.exit(1);
}
if (target && nativeArch) {
  console.error('ERROR: --target and --native-arch are mutually exclusive.');
  process.exit(1);
}
if (nativeArch && !['arm64', 'x64'].includes(nativeArch)) {
  console.error(`ERROR: Unsupported native architecture: ${nativeArch}`);
  process.exit(1);
}
if (nativeArch && process.platform !== 'darwin') {
  console.error('ERROR: --native-arch is only supported on macOS.');
  process.exit(1);
}

const requestedArchitectures = new Set((process.env.ARCHS || '').split(/\s+/).filter(Boolean));
const buildUniversalDarwin =
  process.platform === 'darwin' &&
  !target &&
  !nativeArch &&
  requestedArchitectures.has('arm64') &&
  requestedArchitectures.has('x86_64');
const buildTarget =
  target ||
  (nativeArch === 'arm64'
    ? 'aarch64-apple-darwin'
    : nativeArch === 'x64'
      ? 'x86_64-apple-darwin'
      : null);
const buildTargets = buildUniversalDarwin
  ? ['aarch64-apple-darwin', 'x86_64-apple-darwin']
  : [buildTarget];
const cargoTargetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(rustProject, process.env.CARGO_TARGET_DIR)
  : path.join(rustProject, 'target');

function rustOutputForTarget(cargoBuildTarget) {
  return path.join(
    cargoTargetDir,
    ...(cargoBuildTarget ? [cargoBuildTarget] : []),
    'release',
    process.platform === 'win32' ? 'vibetunnel-fwd.exe' : 'vibetunnel-fwd'
  );
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function commandExists(command) {
  return spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;
}

function findRustCommand(name) {
  const candidates = [
    name,
    process.env.CARGO_HOME ? path.join(process.env.CARGO_HOME, 'bin', name) : null,
    process.env.HOME ? path.join(process.env.HOME, '.cargo', 'bin', name) : null,
  ].filter(Boolean);
  return candidates.find(commandExists) || null;
}

let cargoRunner;
let cargoRunnerArgs;
let rustcRunner;
let rustupRunner;
let usesRustup = false;
if (process.env.CARGO) {
  cargoRunner = process.env.CARGO;
  cargoRunnerArgs = [];
  rustcRunner =
    process.env.RUSTC ||
    findRustCommand(process.platform === 'win32' ? 'rustc.exe' : 'rustc') ||
    (process.platform === 'win32' ? 'rustc.exe' : 'rustc');
} else if (
  (rustupRunner = findRustCommand(process.platform === 'win32' ? 'rustup.exe' : 'rustup'))
) {
  usesRustup = true;
  try {
    cargoRunner = execFileSync(
      rustupRunner,
      ['which', 'cargo', '--toolchain', requiredRustVersion],
      {
        encoding: 'utf8',
      }
    ).trim();
    rustcRunner = execFileSync(
      rustupRunner,
      ['which', 'rustc', '--toolchain', requiredRustVersion],
      {
        encoding: 'utf8',
      }
    ).trim();
  } catch (_error) {
    console.error(`ERROR: Rust ${requiredRustVersion} is required to build vibetunnel-fwd.`);
    console.error(`Install it with: rustup toolchain install ${requiredRustVersion}`);
    process.exit(1);
  }
  cargoRunnerArgs = [];
} else {
  cargoRunner =
    findRustCommand(process.platform === 'win32' ? 'cargo.exe' : 'cargo') ||
    (process.platform === 'win32' ? 'cargo.exe' : 'cargo');
  cargoRunnerArgs = [];
  rustcRunner =
    process.env.RUSTC ||
    findRustCommand(process.platform === 'win32' ? 'rustc.exe' : 'rustc') ||
    (process.platform === 'win32' ? 'rustc.exe' : 'rustc');
}

let actualCargoVersion;
let actualRustcVersion;
try {
  actualCargoVersion = execFileSync(cargoRunner, [...cargoRunnerArgs, '--version'], {
    encoding: 'utf8',
  }).trim();
  actualRustcVersion = execFileSync(rustcRunner, ['--version'], { encoding: 'utf8' }).trim();
} catch (_error) {
  console.error(`ERROR: Rust ${requiredRustVersion} is required to build vibetunnel-fwd.`);
  console.error(`Install it with: rustup toolchain install ${requiredRustVersion}`);
  process.exit(1);
}

const cargoVersion = actualCargoVersion.match(/^cargo (\d+\.\d+\.\d+)/)?.[1];
const rustcVersion = actualRustcVersion.match(/^rustc (\d+\.\d+\.\d+)/)?.[1];
if (cargoVersion !== requiredRustVersion || rustcVersion !== requiredRustVersion) {
  console.error(`ERROR: vibetunnel-fwd requires Rust and Cargo ${requiredRustVersion}.`);
  console.error(`Found ${actualRustcVersion}; ${actualCargoVersion}.`);
  process.exit(1);
}

if (usesRustup) {
  for (const cargoBuildTarget of new Set(buildTargets.filter(Boolean))) {
    execFileSync(
      rustupRunner,
      ['target', 'add', '--toolchain', requiredRustVersion, cargoBuildTarget],
      { stdio: 'inherit' }
    );
  }
}

for (const cargoBuildTarget of buildTargets) {
  console.log(`Building Rust forwarder${cargoBuildTarget ? ` for ${cargoBuildTarget}` : ''}...`);
  const buildArgs = ['build', '--release', '--locked'];
  if (cargoBuildTarget) {
    buildArgs.push('--target', cargoBuildTarget);
  }
  execFileSync(cargoRunner, [...cargoRunnerArgs, ...buildArgs], {
    cwd: rustProject,
    stdio: 'inherit',
    env: {
      ...process.env,
      RUSTC: rustcRunner,
      VIBETUNNEL_VERSION: version,
    },
  });
}

let rustOut = rustOutputForTarget(buildTargets[0]);
if (buildUniversalDarwin) {
  const universalOutDir = path.join(cargoTargetDir, 'universal-apple-darwin', 'release');
  ensureDir(universalOutDir);
  rustOut = path.join(universalOutDir, 'vibetunnel-fwd');
  const universalTemp = `${rustOut}.${process.pid}.tmp`;
  try {
    execFileSync(
      'lipo',
      ['-create', ...buildTargets.map(rustOutputForTarget), '-output', universalTemp],
      { stdio: 'inherit' }
    );
    for (const architecture of ['arm64', 'x86_64']) {
      execFileSync('lipo', [universalTemp, '-verify_arch', architecture], {
        stdio: 'inherit',
      });
    }
    fs.renameSync(universalTemp, rustOut);
  } finally {
    if (fs.existsSync(universalTemp)) {
      fs.rmSync(universalTemp);
    }
  }
}

if (!fs.existsSync(rustOut)) {
  console.error(`ERROR: cargo build did not produce vibetunnel-fwd at ${rustOut}`);
  process.exit(1);
}

if (output) {
  const outputPath = path.resolve(webRoot, output);
  ensureDir(path.dirname(outputPath));
  fs.copyFileSync(rustOut, outputPath);
  fs.chmodSync(outputPath, 0o755);
  if (process.platform === 'darwin') {
    const runnableArchitectures = buildUniversalDarwin
      ? ['arm64', 'x64']
      : nativeArch
        ? [nativeArch]
        : target === 'aarch64-apple-darwin'
          ? ['arm64']
          : target === 'x86_64-apple-darwin'
            ? ['x64']
            : [];
    for (const architecture of runnableArchitectures) {
      const useRosetta = architecture === 'x64' && process.arch !== 'x64';
      execFileSync(
        useRosetta ? 'arch' : outputPath,
        useRosetta ? ['-x86_64', outputPath, '--help'] : ['--help'],
        {
          encoding: 'utf8',
          timeout: 5000,
        }
      );
    }
  }
  console.log(`✓ Rust forwarder built: ${path.relative(repoRoot, outputPath)}`);
  process.exit(0);
}

ensureDir(nativeOutDir);
ensureDir(binOutDir);
const nativeDest = path.join(nativeOutDir, 'vibetunnel-fwd');
const binDest = path.join(binOutDir, 'vibetunnel-fwd');

fs.copyFileSync(rustOut, nativeDest);
fs.copyFileSync(rustOut, binDest);
fs.chmodSync(nativeDest, 0o755);
fs.chmodSync(binDest, 0o755);

console.log(`✓ Rust forwarder built: ${path.relative(repoRoot, nativeDest)}`);
console.log(`✓ Rust forwarder installed: ${path.relative(repoRoot, binDest)}`);
