import { spawn } from 'child_process';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync } from 'fs';
import * as net from 'net';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionData } from '../types/test-types';
import {
  cleanupTestDirectories,
  type ServerInstance,
  sleep,
  startTestServer,
  stopServer,
} from '../utils/server-utils';

function resolveForwarderPath(): string {
  const candidates: string[] = [];
  if (process.env.VIBETUNNEL_FWD_BIN) {
    candidates.push(process.env.VIBETUNNEL_FWD_BIN);
  }
  candidates.push(path.join(process.cwd(), 'native', 'vibetunnel-fwd'));
  candidates.push(path.join(process.cwd(), 'bin', 'vibetunnel-fwd'));

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      accessSync(candidate, constants.X_OK);
      return candidate;
    }
  }

  throw new Error(
    `vibetunnel-fwd not found. Run: node scripts/build-fwd-zig.js (cwd: ${process.cwd()})`
  );
}

function createShortHomeDir(): string {
  return mkdtempSync(path.join('/tmp', 'vth-'));
}

async function waitForPathExists(pathToCheck: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(pathToCheck)) {
      return;
    }
    await sleep(50);
  }
  throw new Error(`Path ${pathToCheck} did not appear after ${timeoutMs}ms`);
}

async function waitForFileContains(
  filePath: string,
  marker: string,
  timeoutMs = 10000
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      if (content.includes(marker)) {
        return content;
      }
    }
    await sleep(100);
  }
  throw new Error(`File ${filePath} missing marker after ${timeoutMs}ms`);
}

async function sendIpcFrame(socketPath: string, type: number, payload: Buffer): Promise<void> {
  const header = Buffer.alloc(5);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(payload.length, 1);
  const frame = Buffer.concat([header, payload]);

  await new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      if (error) reject(error);
      else resolve();
    };

    const socket = net.createConnection({ path: socketPath });
    socket.on('error', (error) =>
      finish(error instanceof Error ? error : new Error(String(error)))
    );
    socket.on('connect', () => {
      socket.end(frame);
    });
    socket.on('close', () => finish());
  });
}

async function sendIpcStdin(socketPath: string, data: string): Promise<void> {
  await sendIpcFrame(socketPath, 0x01, Buffer.from(data, 'utf-8'));
}

async function sendIpcControlCmd(socketPath: string, cmd: unknown): Promise<void> {
  await sendIpcFrame(socketPath, 0x02, Buffer.from(JSON.stringify(cmd), 'utf-8'));
}

async function waitForSession(
  port: number,
  sessionId: string,
  timeoutMs = 10000
): Promise<SessionData> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await fetch(`http://localhost:${port}/api/sessions`);
    if (response.ok) {
      const sessions = (await response.json()) as SessionData[];
      const session = sessions.find((item) => item.id === sessionId);
      if (session) {
        return session;
      }
    }
    await sleep(200);
  }
  throw new Error(`Session ${sessionId} not visible after ${timeoutMs}ms`);
}

async function waitForSessionText(
  port: number,
  sessionId: string,
  marker: string,
  timeoutMs = 10000
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await fetch(`http://localhost:${port}/api/sessions/${sessionId}/text`);
    if (response.ok) {
      const text = await response.text();
      if (text.includes(marker)) {
        return text;
      }
    }
    await sleep(200);
  }
  throw new Error(`Session ${sessionId} text missing marker after ${timeoutMs}ms`);
}

async function waitForSessionName(
  port: number,
  sessionId: string,
  expectedName: string,
  timeoutMs = 10000
): Promise<SessionData> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await fetch(`http://localhost:${port}/api/sessions`);
    if (response.ok) {
      const sessions = (await response.json()) as SessionData[];
      const session = sessions.find((item) => item.id === sessionId);
      if (session?.name === expectedName) {
        return session;
      }
    }
    await sleep(200);
  }
  throw new Error(`Session ${sessionId} name did not update after ${timeoutMs}ms`);
}

describe('Forwarder E2E', () => {
  let server: ServerInstance | null = null;
  let homeDir = '';
  let controlDir = '';

  beforeAll(async () => {
    homeDir = createShortHomeDir();
    controlDir = path.join(homeDir, '.vibetunnel', 'control');

    server = await startTestServer({
      args: ['--port', '0', '--no-auth'],
      env: { VIBETUNNEL_CONTROL_DIR: controlDir },
      waitForHealth: true,
    });
  });

  afterAll(async () => {
    if (server) {
      await stopServer(server.process);
    }
    if (homeDir) {
      await cleanupTestDirectories([homeDir]);
    }
  });

  it('creates session and exposes output', async () => {
    const forwarderPath = resolveForwarderPath();
    const sessionId = `fwd_${Date.now()}`;
    const marker = `forwarder-ok-${Date.now()}`;
    const command = `printf "${marker}\\n"; sleep 0.2`;

    if (!server) {
      throw new Error('Server not started');
    }

    const child = spawn(forwarderPath, ['--session-id', sessionId, '/bin/bash', '-lc', command], {
      env: {
        ...process.env,
        HOME: homeDir,
      },
      stdio: 'ignore',
    });

    let exitError: Error | null = null;
    const exitPromise = new Promise<void>((resolve) => {
      child.on('error', (error) => {
        exitError = error instanceof Error ? error : new Error(String(error));
        resolve();
      });
      child.on('exit', (code, signal) => {
        if (code !== 0) {
          exitError = new Error(
            `forwarder exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`
          );
        }
        resolve();
      });
    });

    const session = await waitForSession(server.port, sessionId);
    expect(session.status).toMatch(/running|exited/);

    const text = await waitForSessionText(server.port, sessionId, marker);
    expect(text).toContain(marker);

    await exitPromise;
    if (exitError) {
      throw exitError;
    }

    const sessionDir = path.join(controlDir, sessionId);
    const sessionJsonPath = path.join(sessionDir, 'session.json');
    const stdoutPath = path.join(sessionDir, 'stdout');

    expect(existsSync(sessionJsonPath)).toBe(true);
    expect(existsSync(stdoutPath)).toBe(true);

    const stdoutContent = readFileSync(stdoutPath, 'utf-8');
    expect(stdoutContent).toContain(marker);
  }, 20000);

  it('accepts stdin and records resize via ipc.sock', async () => {
    const forwarderPath = resolveForwarderPath();
    const sessionId = `fwd_${Date.now()}`;
    const marker = `ipc-ok-${Date.now()}`;
    const input = `hello-${Date.now()}`;
    const expected = `${marker}:${input}`;

    if (!server) {
      throw new Error('Server not started');
    }

    const command = `read line; echo "${marker}:$line"; sleep 0.2`;

    const child = spawn(forwarderPath, ['--session-id', sessionId, '/bin/bash', '-lc', command], {
      env: {
        ...process.env,
        HOME: homeDir,
      },
      stdio: 'ignore',
    });

    const killTimer = setTimeout(() => {
      child.kill('SIGTERM');
    }, 10_000);

    let exitError: Error | null = null;
    const exitPromise = new Promise<void>((resolve) => {
      child.on('error', (error) => {
        exitError = error instanceof Error ? error : new Error(String(error));
        resolve();
      });
      child.on('exit', (code, signal) => {
        clearTimeout(killTimer);
        if (code !== 0) {
          exitError = new Error(
            `forwarder exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`
          );
        }
        resolve();
      });
    });

    await waitForSession(server.port, sessionId);

    const sessionDir = path.join(controlDir, sessionId);
    const ipcPath = path.join(sessionDir, 'ipc.sock');
    const stdoutPath = path.join(sessionDir, 'stdout');

    await waitForPathExists(ipcPath);
    await waitForPathExists(stdoutPath);

    await sendIpcControlCmd(ipcPath, { cmd: 'resize', cols: 80, rows: 24 });
    await sendIpcStdin(ipcPath, `${input}\n`);

    const text = await waitForSessionText(server.port, sessionId, expected);
    expect(text).toContain(expected);

    const stdoutContent = await waitForFileContains(stdoutPath, '80x24');
    expect(stdoutContent).toContain('80x24');

    await exitPromise;
    if (exitError) {
      throw exitError;
    }
  }, 20000);

  it('updates session title via --update-title', async () => {
    const forwarderPath = resolveForwarderPath();
    const sessionId = `fwd_${Date.now()}`;
    const marker = `title-ok-${Date.now()}`;
    const expectedTitle = `E2E Title ${Date.now()}`;
    const command = `printf "${marker}\\n"; sleep 5`;

    if (!server) {
      throw new Error('Server not started');
    }

    const child = spawn(forwarderPath, ['--session-id', sessionId, '/bin/bash', '-lc', command], {
      env: {
        ...process.env,
        HOME: homeDir,
      },
      stdio: 'ignore',
    });

    const killTimer = setTimeout(() => {
      child.kill('SIGTERM');
    }, 10_000);

    let manualKill = false;
    let exitError: Error | null = null;
    const exitPromise = new Promise<void>((resolve) => {
      child.on('error', (error) => {
        exitError = error instanceof Error ? error : new Error(String(error));
        resolve();
      });
      child.on('exit', (code, signal) => {
        clearTimeout(killTimer);
        if (code !== 0 && !manualKill) {
          exitError = new Error(
            `forwarder exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`
          );
        }
        resolve();
      });
    });

    await waitForSession(server.port, sessionId);
    await waitForSessionText(server.port, sessionId, marker);

    const updater = spawn(
      forwarderPath,
      ['--session-id', sessionId, '--update-title', expectedTitle],
      {
        env: {
          ...process.env,
          HOME: homeDir,
        },
        stdio: 'ignore',
      }
    );

    await new Promise<void>((resolve, reject) => {
      updater.on('error', (error) =>
        reject(error instanceof Error ? error : new Error(String(error)))
      );
      updater.on('exit', (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(`update-title exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`)
        );
      });
    });

    const sessionDir = path.join(controlDir, sessionId);
    const sessionJsonPath = path.join(sessionDir, 'session.json');
    await waitForPathExists(sessionJsonPath);

    const json = JSON.parse(readFileSync(sessionJsonPath, 'utf-8')) as { name?: string };
    expect(json.name).toBe(expectedTitle);

    const updated = await waitForSessionName(server.port, sessionId, expectedTitle);
    expect(updated.name).toBe(expectedTitle);

    manualKill = true;
    child.kill('SIGTERM');

    await exitPromise;
    if (exitError) {
      throw exitError;
    }
  }, 20000);
});
