import { spawn } from 'child_process';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync } from 'fs';
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
});
