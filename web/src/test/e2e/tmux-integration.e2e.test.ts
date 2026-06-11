import { spawnSync } from 'child_process';
import { mkdtempSync } from 'fs';
import * as pty from 'node-pty';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  cleanupTestDirectories,
  type ServerInstance,
  sleep,
  startTestServer,
  stopServer,
} from '../utils/server-utils';

vi.unmock('node-pty');

function isTmuxAvailable(): boolean {
  const result = spawnSync('tmux', ['-V'], { stdio: 'ignore' });
  return result.status === 0;
}

function runTmux(args: string[], env: NodeJS.ProcessEnv): string {
  const result = spawnSync('tmux', args, {
    env,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status === 0) {
    return result.stdout;
  }

  throw new Error(
    `tmux ${args.join(' ')} failed with code ${result.status ?? 'null'}:\n${String(result.stderr)}`
  );
}

function tmux(args: string[], env: NodeJS.ProcessEnv): void {
  runTmux(args, env);
}

function getTmuxClientPids(sessionName: string, env: NodeJS.ProcessEnv): number[] {
  const output = runTmux(['list-clients', '-t', sessionName, '-F', '#{client_pid}'], env).trim();
  return output
    ? output
        .split(/\r?\n/)
        .map(Number)
        .filter((pid) => Number.isInteger(pid))
    : [];
}

async function waitForTmuxClientCount(
  sessionName: string,
  env: NodeJS.ProcessEnv,
  expectedCount: number,
  timeoutMs = 10000
): Promise<number[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const clientPids = getTmuxClientPids(sessionName, env);
    if (clientPids.length === expectedCount) {
      return clientPids;
    }
    await sleep(100);
  }
  throw new Error(`Tmux session ${sessionName} did not reach ${expectedCount} clients`);
}

async function waitForSessionText(
  port: number,
  sessionId: string,
  marker: string,
  timeoutMs = 10000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await fetch(`http://localhost:${port}/api/sessions/${sessionId}/text`);
    if (response.ok) {
      const text = await response.text();
      if (text.includes(marker)) {
        return;
      }
    }
    await sleep(200);
  }
  throw new Error(`Session ${sessionId} text missing marker after ${timeoutMs}ms`);
}

const hasTmux = isTmuxAvailable();
const describeTmux = hasTmux ? describe : describe.skip;

describeTmux('Tmux integration (E2E)', () => {
  let server: ServerInstance | null = null;
  let homeDir = '';
  let tmuxTmpDir = '';

  beforeAll(async () => {
    homeDir = mkdtempSync(path.join('/tmp', 'vth-'));
    tmuxTmpDir = mkdtempSync(path.join('/tmp', 'vtt-'));

    server = await startTestServer({
      args: ['--port', '0', '--no-auth'],
      env: {
        HOME: homeDir,
        TMUX_TMPDIR: tmuxTmpDir,
      },
      controlDir: path.join(homeDir, '.vibetunnel', 'control'),
      waitForHealth: true,
    });
  });

  afterAll(async () => {
    if (server) {
      await stopServer(server.process);
    }

    try {
      tmux(['kill-server'], { ...process.env, TMUX_TMPDIR: tmuxTmpDir });
    } catch {
      // Ignore if no server is running.
    }

    await cleanupTestDirectories([homeDir, tmuxTmpDir]);
  });

  it('detaches only the API client with a remapped tmux prefix', async () => {
    if (!server) {
      throw new Error('Server not started');
    }

    const sessionName = `vt_tmux_${Date.now()}`;
    const marker = `tmux-ok-${Date.now()}`;
    const tmuxEnv = { ...process.env, TMUX_TMPDIR: tmuxTmpDir };
    let externalClient: pty.IPty | null = null;
    let externalClientOutput = '';
    let externalClientExit: { exitCode: number; signal?: number } | null = null;

    try {
      tmux(['new-session', '-d', '-s', sessionName], tmuxEnv);
      tmux(['set-option', '-g', 'prefix', 'C-a'], tmuxEnv);
      tmux(['unbind-key', 'C-b'], tmuxEnv);

      externalClient = pty.spawn('tmux', ['attach-session', '-t', sessionName], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: homeDir,
        env: tmuxEnv,
      });
      externalClient.onData((data) => {
        externalClientOutput += data;
      });
      externalClient.onExit((event) => {
        externalClientExit = event;
      });
      try {
        await waitForTmuxClientCount(sessionName, tmuxEnv, 1);
      } catch (error) {
        throw new Error(
          `${String(error)}; external client exit=${JSON.stringify(externalClientExit)} output=${JSON.stringify(externalClientOutput)}`
        );
      }

      const statusResponse = await fetch(`http://localhost:${server.port}/api/multiplexer/status`);
      expect(statusResponse.ok).toBe(true);
      const status = (await statusResponse.json()) as {
        tmux?: { available: boolean; sessions: Array<{ name: string }> };
      };

      expect(status.tmux?.available).toBe(true);
      expect(status.tmux?.sessions.map((item) => item.name)).toContain(sessionName);

      const attachResponse = await fetch(`http://localhost:${server.port}/api/multiplexer/attach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'tmux',
          sessionName,
          cols: 80,
          rows: 24,
        }),
      });

      expect(attachResponse.ok).toBe(true);
      const attachJson = (await attachResponse.json()) as { sessionId: string };
      expect(attachJson.sessionId).toBeTruthy();
      await waitForTmuxClientCount(sessionName, tmuxEnv, 2);

      const inputResponse = await fetch(
        `http://localhost:${server.port}/api/sessions/${attachJson.sessionId}/input`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `echo ${marker}\n` }),
        }
      );
      expect(inputResponse.ok).toBe(true);

      await waitForSessionText(server.port, attachJson.sessionId, marker, 15000);

      const deleteResponse = await fetch(
        `http://localhost:${server.port}/api/sessions/${attachJson.sessionId}`,
        { method: 'DELETE' }
      );
      expect(deleteResponse.ok).toBe(true);

      const remainingClientPids = await waitForTmuxClientCount(sessionName, tmuxEnv, 1);
      expect(remainingClientPids).toEqual([externalClient.pid]);
      expect(runTmux(['capture-pane', '-p', '-t', sessionName], tmuxEnv)).not.toContain(
        'd:detach-client'
      );
    } finally {
      externalClient?.kill();
      try {
        tmux(['kill-session', '-t', sessionName], tmuxEnv);
      } catch {
        // Ignore cleanup if the test already removed the session.
      }
    }
  }, 20000);
});
