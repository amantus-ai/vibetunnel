#!/usr/bin/env node

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const packageArgument = process.argv.slice(2).find((argument) => argument !== '--');
if (!packageArgument) {
  console.error('Usage: node scripts/test-npm-docker-package.js <package.tgz>');
  process.exit(1);
}

const packagePath = path.resolve(packageArgument);
const contextDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetunnel-npm-docker-'));
const uniqueId = `${process.pid}-${Date.now()}`;
const imageTag = `vibetunnel-npm-package-test:${uniqueId}`;
const containerName = `vibetunnel-npm-package-test-${uniqueId}`;
let containerStarted = false;

function docker(args, options = {}) {
  return execFileSync('docker', args, {
    encoding: options.encoding,
    stdio: options.stdio || (options.encoding ? 'pipe' : 'inherit'),
  });
}

function cleanup() {
  if (containerStarted) {
    spawnSync('docker', ['stop', containerName], { stdio: 'ignore' });
  }
  spawnSync('docker', ['image', 'rm', '--force', imageTag], { stdio: 'ignore' });
  fs.rmSync(contextDir, { recursive: true, force: true });
}

async function waitForHealth(port, expectedVersion) {
  const healthUrl = `http://127.0.0.1:${port}/api/health`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        const health = await response.json();
        if (health.status !== 'healthy' || health.version !== expectedVersion) {
          throw new Error(`Unexpected health response: ${JSON.stringify(health)}`);
        }
        return health;
      }
    } catch {
      // The packaged server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const logs = docker(['logs', containerName], { encoding: 'utf8' });
  throw new Error(`Timed out waiting for ${healthUrl}:\n${logs}`);
}

async function testSession(port) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const marker = `npm-docker-package-${Date.now()}`;
  const createResponse = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      command: ['/bin/sh', '-lc', `printf ${marker}; sleep 5`],
      cols: 80,
      rows: 24,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!createResponse.ok) {
    throw new Error(
      `Session creation failed: ${createResponse.status} ${await createResponse.text()}`
    );
  }

  const { sessionId } = await createResponse.json();
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const textResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}/text`, {
        signal: AbortSignal.timeout(1000),
      });
      const text = await textResponse.text();
      if (textResponse.ok && text.includes(marker)) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Packaged Docker session did not emit marker: ${marker}`);
  } finally {
    await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }
}

async function main() {
  if (!fs.existsSync(packagePath)) {
    throw new Error(`Package does not exist: ${packagePath}`);
  }

  execFileSync(
    'tar',
    ['-xzf', packagePath, '--strip-components=1', '-C', contextDir],
    { stdio: 'inherit' }
  );

  const packageJson = JSON.parse(fs.readFileSync(path.join(contextDir, 'package.json'), 'utf8'));
  const dockerfilePath = path.join(contextDir, 'Dockerfile.standalone');
  const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
  for (const sourceBuildMarker of [
    'pnpm-lock.yaml',
    'native/vt-fwd',
    'cargo build',
    'VT_FWD_COMMIT',
  ]) {
    if (dockerfile.includes(sourceBuildMarker)) {
      throw new Error(`Packaged Dockerfile contains source build input: ${sourceBuildMarker}`);
    }
  }

  docker(['build', '-f', dockerfilePath, '-t', imageTag, contextDir]);

  const forwarderHelp = docker(
    [
      'run',
      '--rm',
      '--entrypoint',
      'node',
      imageTag,
      '/app/bin/vibetunnel',
      'fwd',
      '--help',
    ],
    { encoding: 'utf8' }
  );
  if (!forwarderHelp.includes('VibeTunnel Forward')) {
    throw new Error(`Packaged Rust forwarder did not run:\n${forwarderHelp}`);
  }

  docker([
    'run',
    '--detach',
    '--rm',
    '--name',
    containerName,
    '--publish',
    '127.0.0.1::4020',
    imageTag,
    '--no-auth',
  ], { encoding: 'utf8' });
  containerStarted = true;

  const portOutput = docker(['port', containerName, '4020/tcp'], { encoding: 'utf8' });
  const port = portOutput.match(/127\.0\.0\.1:(\d+)/)?.[1];
  if (!port) {
    throw new Error(`Could not determine packaged server port: ${portOutput.trim()}`);
  }

  await waitForHealth(port, packageJson.version);
  await testSession(port);
  console.log(`npm Docker package smoke passed (${packageJson.version}, port ${port})`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(cleanup);
