import { spawnSync } from 'child_process';
import { mkdtempSync } from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupTestDirectories,
  type ServerInstance,
  sleep,
  startTestServer,
  stopServer,
} from '../utils/server-utils';

function isTmuxAvailable(): boolean {
  const result = spawnSync('tmux', ['-V'], { stdio: 'ignore' });
  return result.status === 0;
}

function tmux(args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync('tmux', args, {
    env,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status === 0) {
    return;
  }

  throw new Error(
    `tmux ${args.join(' ')} failed with code ${result.status ?? 'null'}:\n${String(result.stderr)}`
  );
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

  it('lists and attaches to a tmux session via API', async () => {
    if (!server) {
      throw new Error('Server not started');
    }

    const sessionName = `vt_tmux_${Date.now()}`;
    const marker = `tmux-ok-${Date.now()}`;
    const tmuxEnv = { ...process.env, TMUX_TMPDIR: tmuxTmpDir };

    tmux(['new-session', '-d', '-s', sessionName], tmuxEnv);

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

    await fetch(`http://localhost:${server.port}/api/sessions/${attachJson.sessionId}`, {
      method: 'DELETE',
    });

    tmux(['kill-session', '-t', sessionName], tmuxEnv);
  }, 20000);
});
