#!/usr/bin/env node

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const packagePath = process.argv[2];
if (!packagePath) {
  console.error('Usage: node scripts/test-npm-package.js <package.tgz>');
  process.exit(1);
}

const absolutePackagePath = path.resolve(packagePath);
const expectedVersion = require('../package.json').version;
const domPurifyEntry = require.resolve('dompurify');
const expectedDomPurifyVersion = JSON.parse(
  fs.readFileSync(path.join(path.dirname(domPurifyEntry), '..', 'package.json'), 'utf8')
).version;
const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetunnel-npm-smoke-'));
const controlTmpDir = process.platform === 'win32' ? os.tmpdir() : '/tmp';
const controlDir = fs.mkdtempSync(path.join(controlTmpDir, 'vtn-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const cli = path.join(
  installDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vibetunnel.cmd' : 'vibetunnel'
);

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate a test port'));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitForHealth(baseUrl, server, stderr) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Packaged server exited early (${server.exitCode}):\n${stderr()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response.json();
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for packaged server:\n${stderr()}`);
}

async function waitForSessionText(baseUrl, sessionId, marker) {
  let lastText = '';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/text`);
    lastText = await response.text();
    if (response.ok && lastText.includes(marker)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Session text did not contain ${marker}; last response: ${lastText}`);
}

function listUploads(uploadsDir) {
  return fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : [];
}

async function abortPartialUpload(baseUrl, uploadsDir, expectedFiles) {
  const boundary = 'vibetunnel-aborted-upload-smoke';
  const request = http.request(`${baseUrl}/api/files/upload`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
  request.on('error', () => {
    // Destroying the request below intentionally resets the connection.
  });
  request.write(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="partial.txt"\r\nContent-Type: text/plain\r\n\r\n`
  );
  request.write(Buffer.alloc(64 * 1024, 'x'));

  let partialObserved = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (listUploads(uploadsDir).length > expectedFiles) {
      partialObserved = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  request.destroy();
  if (!partialObserved) throw new Error('Aborted upload did not create a partial file');

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (listUploads(uploadsDir).length === expectedFiles) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Aborted upload left files behind: ${listUploads(uploadsDir).join(', ')}`);
}

async function testFileUploads(baseUrl, controlDir) {
  const uploadsDir = path.join(controlDir, 'uploads');
  const form = new FormData();
  form.append('file', new Blob(['packaged upload smoke']), 'smoke.txt');
  const uploadResponse = await fetch(`${baseUrl}/api/files/upload`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(5000),
  });
  if (!uploadResponse.ok) {
    throw new Error(`File upload failed: ${uploadResponse.status} ${await uploadResponse.text()}`);
  }
  const upload = await uploadResponse.json();
  if (fs.readFileSync(upload.path, 'utf8') !== 'packaged upload smoke') {
    throw new Error('Uploaded file content did not match');
  }

  const nestedForm = new FormData();
  nestedForm.append('a[b]', 'rejected');
  const nestedResponse = await fetch(`${baseUrl}/api/files/upload`, {
    method: 'POST',
    body: nestedForm,
    signal: AbortSignal.timeout(5000),
  });
  if (nestedResponse.ok) throw new Error('Nested multipart field was not rejected');

  await abortPartialUpload(baseUrl, uploadsDir, 1);

  const deleteResponse = await fetch(`${baseUrl}/api/files/${upload.filename}`, {
    method: 'DELETE',
  });
  if (!deleteResponse.ok || listUploads(uploadsDir).length !== 0) {
    throw new Error('Uploaded smoke-test file was not deleted');
  }
}

async function testMonacoSanitizer(baseUrl) {
  const response = await fetch(`${baseUrl}/monaco-editor/monaco.js`);
  if (!response.ok) throw new Error(`Monaco bundle request failed: ${response.status}`);
  const bundle = await response.text();
  if (
    !bundle.includes(`DOMPurify ${expectedDomPurifyVersion}`) ||
    bundle.includes('DOMPurify 3.2.7')
  ) {
    throw new Error('Served Monaco bundle does not contain the patched DOMPurify version');
  }
}

function encodeSubscribeFrame(sessionId) {
  const sessionBytes = Buffer.from(sessionId);
  const payload = Buffer.alloc(12);
  payload.writeUInt32LE(2, 0);

  const frame = Buffer.alloc(12 + sessionBytes.length + payload.length);
  frame.writeUInt16LE(0x5654, 0);
  frame.writeUInt8(3, 2);
  frame.writeUInt8(10, 3);
  frame.writeUInt32LE(sessionBytes.length, 4);
  sessionBytes.copy(frame, 8);
  frame.writeUInt32LE(payload.length, 8 + sessionBytes.length);
  payload.copy(frame, 12 + sessionBytes.length);
  return frame;
}

function waitForSnapshot(baseUrl, sessionId) {
  return new Promise((resolve, reject) => {
    const wsUrl = baseUrl.replace(/^http/, 'ws');
    const ws = new WebSocket(`${wsUrl}/ws`);
    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error('Timed out waiting for a VT snapshot'));
    }, 10_000);

    ws.once('open', () => ws.send(encodeSubscribeFrame(sessionId)));
    ws.on('message', (data, isBinary) => {
      if (!isBinary) return;
      const frame = Buffer.from(data);
      if (frame.length < 12 || frame.readUInt16LE(0) !== 0x5654 || frame.readUInt8(2) !== 3) {
        return;
      }

      const type = frame.readUInt8(3);
      const sessionLength = frame.readUInt32LE(4);
      const payloadOffset = 12 + sessionLength;
      if (type !== 21 || frame.length < payloadOffset + 3) return;

      const payload = frame.subarray(payloadOffset);
      if (payload.readUInt16LE(0) !== 0x5654 || payload.readUInt8(2) !== 1) {
        clearTimeout(timeout);
        ws.close();
        reject(new Error('Received an invalid VT snapshot'));
        return;
      }

      clearTimeout(timeout);
      ws.close();
      resolve(payload.length);
    });
    ws.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function isRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

async function stopServer(server) {
  if (!isRunning(server)) return;

  server.kill('SIGTERM');
  const exited = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 3000);
    server.once('exit', () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
  if (!exited && isRunning(server)) {
    server.kill('SIGKILL');
    throw new Error('Packaged server did not stop within 3 seconds of SIGTERM');
  }
}

async function main() {
  let server;
  let stdout = '';
  let stderr = '';

  try {
    execFileSync(npm, ['init', '-y'], { cwd: installDir, stdio: 'ignore' });
    execFileSync(npm, ['install', '--no-audit', '--no-fund', absolutePackagePath], {
      cwd: installDir,
      stdio: 'inherit',
    });

    const version = execFileSync(cli, ['version'], { cwd: installDir, encoding: 'utf8' });
    if (!version.includes(expectedVersion)) {
      throw new Error(`Unexpected packaged version: ${version.trim()}`);
    }
    const forwarderHelp = execFileSync(cli, ['fwd', '--help'], {
      cwd: installDir,
      encoding: 'utf8',
    });
    if (!forwarderHelp.includes('VibeTunnel Forward')) {
      throw new Error('Platform zig forwarder did not run');
    }

    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    server = spawn(cli, ['--port', String(port), '--no-auth'], {
      cwd: installDir,
      env: { ...process.env, VIBETUNNEL_CONTROL_DIR: controlDir, VIBETUNNEL_VERBOSE: 'debug' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    server.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    const health = await waitForHealth(baseUrl, server, () => `${stdout}\n${stderr}`);
    if (health.status !== 'healthy' || health.version !== expectedVersion) {
      throw new Error(`Unexpected health response: ${JSON.stringify(health)}`);
    }
    await testMonacoSanitizer(baseUrl);
    await testFileUploads(baseUrl, controlDir);

    const marker = `npm-package-runtime-${process.platform}-${process.arch}`;
    const createResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        command: ['/bin/sh', '-lc', `printf ${marker}; sleep 30`],
        cols: 80,
        rows: 24,
      }),
    });
    if (!createResponse.ok) {
      throw new Error(
        `Session creation failed: ${createResponse.status} ${await createResponse.text()}`
      );
    }
    const { sessionId } = await createResponse.json();
    await waitForSessionText(baseUrl, sessionId, marker);
    const snapshotBytes = await waitForSnapshot(baseUrl, sessionId);
    await fetch(`${baseUrl}/api/sessions/${sessionId}`, { method: 'DELETE' });

    if (
      stderr.includes('ghostty-web wasm not found') ||
      stderr.includes('Failed to init terminal')
    ) {
      throw new Error(`Packaged terminal initialization failed:\n${stderr}`);
    }

    console.log(
      `npm package smoke passed (${process.platform}/${process.arch}, snapshot ${snapshotBytes} bytes)`
    );
    await stopServer(server);
    server = undefined;
  } catch (error) {
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    throw new Error(
      `${detail}\nPackaged server stdout:\n${stdout}\nPackaged server stderr:\n${stderr}`
    );
  } finally {
    if (server && isRunning(server)) {
      server.kill('SIGTERM');
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 3000);
        server.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      if (isRunning(server)) server.kill('SIGKILL');
    }
    fs.rmSync(installDir, { recursive: true, force: true });
    fs.rmSync(controlDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
