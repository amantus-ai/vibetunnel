import { spawn, spawnSync } from 'child_process';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'fs';
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

const hasGit = (() => {
  try {
    const result = spawnSync('git', ['--version'], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
})();

const itWithGit = hasGit ? it : it.skip;

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

function createVibeTunnelCliWrapper(homeDir: string): string {
  const cliPath = path.join(process.cwd(), 'src', 'cli.ts');
  const wrapperDir = path.join(homeDir, 'bin');
  const wrapperPath = path.join(wrapperDir, 'vibetunnel');

  mkdirSync(wrapperDir, { recursive: true });
  writeFileSync(wrapperPath, `#!/usr/bin/env bash\nexec tsx "${cliPath}" "$@"\n`, 'utf-8');
  chmodSync(wrapperPath, 0o755);
  return wrapperPath;
}

function listSessionDirs(controlDir: string): string[] {
  if (!existsSync(controlDir)) {
    return [];
  }
  return readdirSync(controlDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

async function waitForNewSessionDir(
  controlDir: string,
  before: Set<string>,
  timeoutMs = 10000
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const name of listSessionDirs(controlDir)) {
      if (!before.has(name)) {
        return name;
      }
    }
    await sleep(50);
  }
  throw new Error(`No new session directory appeared after ${timeoutMs}ms`);
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

function runGit(cwd: string, args: string[]): { stdout: string; stderr: string; code: number } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  return {
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    code: result.status ?? 1,
  };
}

describe('vt wrapper flows', () => {
  let server: ServerInstance | null = null;
  let homeDir = '';
  let controlDir = '';
  let vibetunnelBin = '';

  beforeAll(async () => {
    homeDir = createShortHomeDir();
    controlDir = path.join(homeDir, '.vibetunnel', 'control');
    vibetunnelBin = createVibeTunnelCliWrapper(homeDir);

    server = await startTestServer({
      args: ['--port', '0', '--no-auth'],
      env: { VIBETUNNEL_CONTROL_DIR: controlDir },
      waitForHealth: true,
    });

    await waitForPathExists(path.join(controlDir, 'api.sock'));
  });

  afterAll(async () => {
    if (server) {
      await stopServer(server.process);
    }
    if (homeDir) {
      await cleanupTestDirectories([homeDir]);
    }
  });

  it('runs via vibetunnel fwd wrapper (tsx cli.ts)', async () => {
    const forwarderPath = resolveForwarderPath();
    const sessionId = `fwd_${Date.now()}`;
    const marker = `cli-fwd-ok-${Date.now()}`;
    const command = `printf "${marker}\\n"; sleep 0.2`;

    if (!server) {
      throw new Error('Server not started');
    }

    const cliPath = path.join(process.cwd(), 'src', 'cli.ts');
    const child = spawn(
      'tsx',
      [cliPath, 'fwd', '--session-id', sessionId, '/bin/bash', '-lc', command],
      {
        env: {
          ...process.env,
          HOME: homeDir,
          VIBETUNNEL_CONTROL_DIR: controlDir,
          VIBETUNNEL_FWD_BIN: forwarderPath,
        },
        stdio: 'ignore',
      }
    );

    let exitError: Error | null = null;
    const exitPromise = new Promise<void>((resolve) => {
      child.on('error', (error) => {
        exitError = error instanceof Error ? error : new Error(String(error));
        resolve();
      });
      child.on('exit', (code, signal) => {
        if (code !== 0) {
          exitError = new Error(
            `vibetunnel fwd exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`
          );
        }
        resolve();
      });
    });

    const text = await waitForSessionText(server.port, sessionId, marker);
    expect(text).toContain(marker);

    await exitPromise;
    if (exitError) {
      throw exitError;
    }
  }, 20000);

  it('updates session title via vt wrapper (vt title)', async () => {
    const forwarderPath = resolveForwarderPath();
    const sessionId = `fwd_${Date.now()}`;
    const marker = `vt-title-ok-${Date.now()}`;
    const expectedTitle = `VT Title ${Date.now()}`;
    const command = `printf "${marker}\\n"; sleep 5`;

    if (!server) {
      throw new Error('Server not started');
    }

    const child = spawn(forwarderPath, ['--session-id', sessionId, '/bin/bash', '-lc', command], {
      env: {
        ...process.env,
        HOME: homeDir,
        VIBETUNNEL_CONTROL_DIR: controlDir,
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

    await waitForSessionText(server.port, sessionId, marker);

    const vtPath = path.join(process.cwd(), 'bin', 'vt');
    const updater = spawn(vtPath, ['title', expectedTitle], {
      env: {
        ...process.env,
        HOME: homeDir,
        VIBETUNNEL_CONTROL_DIR: controlDir,
        VIBETUNNEL_SESSION_ID: sessionId,
        VIBETUNNEL_FWD_BIN: forwarderPath,
        VIBETUNNEL_BIN: vibetunnelBin,
      },
      stdio: 'ignore',
    });

    await new Promise<void>((resolve, reject) => {
      updater.on('error', (error) =>
        reject(error instanceof Error ? error : new Error(String(error)))
      );
      updater.on('exit', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`vt title exited with code ${code ?? 'null'}`));
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

  it('runs a forwarded command via vt wrapper', async () => {
    const forwarderPath = resolveForwarderPath();
    const marker = `vt-run-ok-${Date.now()}`;
    const command = `printf "${marker}\\n"; sleep 0.2`;

    if (!server) {
      throw new Error('Server not started');
    }

    const before = new Set(listSessionDirs(controlDir));

    const vtPath = path.join(process.cwd(), 'bin', 'vt');
    const child = spawn(vtPath, ['-S', '/bin/bash', '-lc', command], {
      env: {
        ...process.env,
        HOME: homeDir,
        VIBETUNNEL_CONTROL_DIR: controlDir,
        VIBETUNNEL_FWD_BIN: forwarderPath,
        VIBETUNNEL_BIN: vibetunnelBin,
      },
      stdio: 'ignore',
    });

    await new Promise<void>((resolve, reject) => {
      child.on('error', (error) =>
        reject(error instanceof Error ? error : new Error(String(error)))
      );
      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`vt exited with code ${code ?? 'null'}`));
      });
    });

    const sessionId = await waitForNewSessionDir(controlDir, before);
    const text = await waitForSessionText(server.port, sessionId, marker);
    expect(text).toContain(marker);
  }, 20000);

  it('blocks recursive sessions via vt wrapper', async () => {
    const vtPath = path.join(process.cwd(), 'bin', 'vt');
    const child = spawn(vtPath, ['ls'], {
      env: {
        ...process.env,
        HOME: homeDir,
        VIBETUNNEL_CONTROL_DIR: controlDir,
        VIBETUNNEL_BIN: vibetunnelBin,
        VIBETUNNEL_SESSION_ID: 'already-in-session',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    const stderr: string[] = [];
    child.stderr?.on('data', (data) => stderr.push(data.toString()));

    const code = await new Promise<number>((resolve, reject) => {
      child.on('error', (error) =>
        reject(error instanceof Error ? error : new Error(String(error)))
      );
      child.on('exit', (exitCode) => resolve(exitCode ?? 1));
    });

    expect(code).not.toBe(0);
    expect(stderr.join('')).toContain('Recursive VibeTunnel sessions are not supported');
  });

  itWithGit(
    'enables + disables follow mode via vt follow/unfollow',
    async () => {
      const baseDir = mkdtempSync(path.join(homeDir, 'git-'));
      const repoDir = path.join(baseDir, 'repo');
      const worktreeDir = path.join(baseDir, 'wt-feature');
      mkdirSync(repoDir, { recursive: true });

      runGit(repoDir, ['init']);
      runGit(repoDir, ['config', 'user.email', 'test@example.com']);
      runGit(repoDir, ['config', 'user.name', 'VibeTunnel Test']);
      writeFileSync(path.join(repoDir, 'README.md'), `test-${Date.now()}\n`, 'utf-8');
      runGit(repoDir, ['add', 'README.md']);
      runGit(repoDir, ['commit', '-m', 'init']);
      runGit(repoDir, ['config', 'core.hooksPath', '.hooks']);
      runGit(repoDir, ['branch', 'feature']);
      runGit(repoDir, ['worktree', 'add', worktreeDir, 'feature']);

      const vtPath = path.join(process.cwd(), 'bin', 'vt');
      const follow = spawnSync(vtPath, ['follow', 'feature'], {
        cwd: repoDir,
        env: {
          ...process.env,
          HOME: homeDir,
          VIBETUNNEL_CONTROL_DIR: controlDir,
          VIBETUNNEL_BIN: vibetunnelBin,
        },
        encoding: 'utf-8',
      });
      expect(follow.status).toBe(0);

      const followWorktree = runGit(repoDir, ['config', '--local', 'vibetunnel.followWorktree']);
      expect(followWorktree.code).toBe(0);
      expect(realpathSync(followWorktree.stdout.trim())).toBe(realpathSync(worktreeDir));

      const hooksDir = path.join(repoDir, '.hooks');
      const postCommit = readFileSync(path.join(hooksDir, 'post-commit'), 'utf-8');
      const postCheckout = readFileSync(path.join(hooksDir, 'post-checkout'), 'utf-8');
      expect(postCommit).toContain('VibeTunnel Git hook');
      expect(postCheckout).toContain('VibeTunnel Git hook');

      const unfollow = spawnSync(vtPath, ['unfollow'], {
        cwd: repoDir,
        env: {
          ...process.env,
          HOME: homeDir,
          VIBETUNNEL_CONTROL_DIR: controlDir,
          VIBETUNNEL_BIN: vibetunnelBin,
        },
        encoding: 'utf-8',
      });
      expect(unfollow.status).toBe(0);
      expect(unfollow.stdout).toContain('Disabled follow mode');

      const followAfter = runGit(repoDir, ['config', '--local', 'vibetunnel.followWorktree']);
      expect(followAfter.code).not.toBe(0);

      expect(existsSync(path.join(hooksDir, 'post-commit'))).toBe(false);
      expect(existsSync(path.join(hooksDir, 'post-checkout'))).toBe(false);
    },
    30000
  );
});
