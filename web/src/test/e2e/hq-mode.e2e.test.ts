import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  cleanupTestDirectories,
  createTestDirectory,
  type ServerInstance,
  sleep,
  startTestServer,
  stopServer,
  waitForServerHealth,
} from '../utils/server-utils';

// HQ Mode tests for distributed terminal management
describe('HQ Mode E2E Tests', () => {
  let hqServer: ServerInstance | null = null;
  const remoteServers: ServerInstance[] = [];
  const hqUsername = 'hq-admin';
  const hqPassword = 'hq-pass123';
  const testDirs: string[] = [];
  const baseDir = createTestDirectory('vt-hq');

  beforeAll(async () => {
    // Start HQ server
    const hqDir = path.join(baseDir, 'hq');
    fs.mkdirSync(hqDir, { recursive: true });
    testDirs.push(hqDir);

    hqServer = await startTestServer({
      args: ['--port', '0', '--hq'],
      controlDir: hqDir,
      env: {
        VIBETUNNEL_USERNAME: hqUsername,
        VIBETUNNEL_PASSWORD: hqPassword,
      },
      serverType: 'HQ',
    });

    expect(hqServer.port).toBeGreaterThan(0);

    // Wait for HQ server to be fully ready
    const hqReady = await waitForServerHealth(hqServer.port, hqUsername, hqPassword);
    expect(hqReady).toBe(true);

    // Start remote servers
    for (let i = 0; i < 3; i++) {
      const remoteDir = path.join(baseDir, `remote-${i}`);
      fs.mkdirSync(remoteDir, { recursive: true });
      testDirs.push(remoteDir);

      const remoteServer = await startTestServer({
        args: [
          '--port',
          '0',
          '--hq-url',
          `http://localhost:${hqServer.port}`,
          '--hq-username',
          hqUsername,
          '--hq-password',
          hqPassword,
          '--name',
          `remote-${i}`,
          '--allow-insecure-hq',
        ],
        controlDir: remoteDir,
        env: {
          VIBETUNNEL_USERNAME: `remote${i}`,
          VIBETUNNEL_PASSWORD: `remotepass${i}`,
        },
        serverType: `REMOTE-${i}`,
      });

      remoteServers.push(remoteServer);
      expect(remoteServer.port).toBeGreaterThan(0);
      expect(remoteServer.port).not.toBe(hqServer.port);
    }

    // Verify HQ server is ready (already waited above)
    const hqReadyCheck = await waitForServerHealth(hqServer.port, hqUsername, hqPassword);
    expect(hqReadyCheck).toBe(true);

    // Wait for all remote servers to be ready
    for (let i = 0; i < remoteServers.length; i++) {
      const remoteReady = await waitForServerHealth(
        remoteServers[i].port,
        `remote${i}`,
        `remotepass${i}`
      );
      expect(remoteReady).toBe(true);
    }

    // Wait for registration to complete
    await sleep(2000);
  }, 60000); // 60 second timeout for setup

  afterAll(async () => {
    // Kill all remote servers first
    await Promise.all(remoteServers.map((server) => stopServer(server.process)));

    // Then kill HQ server
    if (hqServer) {
      await stopServer(hqServer.process);
    }

    // Clean up test directories
    await cleanupTestDirectories(testDirs);
  }, 30000); // 30 second timeout for cleanup

  it('should list all registered remotes', async () => {
    const response = await fetch(`http://localhost:${hqServer?.port}/api/remotes`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
      },
    });

    expect(response.ok).toBe(true);
    const remotes = await response.json();
    expect(remotes).toHaveLength(3);

    for (let i = 0; i < 3; i++) {
      const remote = remotes.find((r: { name: string; url: string }) => r.name === `remote-${i}`);
      expect(remote).toBeDefined();
      expect(remote.url).toBe(`http://localhost:${remoteServers[i].port}`);
    }
  });

  it('should create sessions on remote servers', async () => {
    const sessionIds: string[] = [];

    // Get remotes
    const remotesResponse = await fetch(`http://localhost:${hqServer?.port}/api/remotes`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
      },
    });
    const remotes = await remotesResponse.json();

    // Create session on each remote
    for (const remote of remotes) {
      const response = await fetch(`http://localhost:${hqServer?.port}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
        },
        body: JSON.stringify({
          command: ['echo', `hello from ${remote.name}`],
          workingDir: os.tmpdir(),
          name: `Test session on ${remote.name}`,
          remoteId: remote.id,
        }),
      });

      expect(response.ok).toBe(true);
      const { sessionId } = await response.json();
      expect(sessionId).toBeDefined();
      sessionIds.push(sessionId);
    }

    // Wait for sessions to be created
    await sleep(1000);

    // Get all sessions and verify aggregation
    const allSessionsResponse = await fetch(`http://localhost:${hqServer?.port}/api/sessions`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
      },
    });

    expect(allSessionsResponse.ok).toBe(true);
    const allSessions = await allSessionsResponse.json();
    const remoteSessions = allSessions.filter((s: { remoteName?: string }) => s.remoteName);
    expect(remoteSessions.length).toBeGreaterThanOrEqual(3);
  });

  it('should proxy session operations to remote servers', async () => {
    // Get a fresh list of remotes to ensure we have current data
    const remotesResponse = await fetch(`http://localhost:${hqServer?.port}/api/remotes`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
      },
    });
    const remotes = await remotesResponse.json();
    const remote = remotes[0];

    // Create session on remote
    const createResponse = await fetch(`http://localhost:${hqServer?.port}/api/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
      },
      body: JSON.stringify({
        command: ['bash', '-c', 'while true; do read input; echo "Got: $input"; done'],
        workingDir: os.tmpdir(),
        name: 'Proxy Test Session',
        remoteId: remote.id,
      }),
    });

    expect(createResponse.ok).toBe(true);
    const { sessionId } = await createResponse.json();

    // Wait a bit for session to be fully created and registered
    await sleep(1000);

    // Get session info through HQ (should proxy to remote)
    const infoResponse = await fetch(
      `http://localhost:${hqServer?.port}/api/sessions/${sessionId}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
        },
      }
    );

    expect(infoResponse.ok).toBe(true);
    const sessionInfo = await infoResponse.json();
    expect(sessionInfo.id).toBe(sessionId);
    expect(sessionInfo.name).toBe('Proxy Test Session');

    // Send input through HQ
    const inputResponse = await fetch(
      `http://localhost:${hqServer?.port}/api/sessions/${sessionId}/input`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
        },
        body: JSON.stringify({ text: 'echo "proxied input"\n' }),
      }
    );
    expect(inputResponse.ok).toBe(true);

    // Kill session through HQ
    const killResponse = await fetch(
      `http://localhost:${hqServer?.port}/api/sessions/${sessionId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
        },
      }
    );
    expect(killResponse.ok).toBe(true);
  });

  it.skip('should aggregate buffer updates through WebSocket', async () => {
    const sessionIds: string[] = [];

    // Create sessions for WebSocket test
    const remotesResponse = await fetch(`http://localhost:${hqServer?.port}/api/remotes`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
      },
    });
    const remotes = await remotesResponse.json();

    for (const remote of remotes) {
      const response = await fetch(`http://localhost:${hqServer?.port}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
        },
        body: JSON.stringify({
          command: [
            'bash',
            '-c',
            `for i in {1..10}; do echo "${remote.name} message $i"; sleep 0.5; done`,
          ],
          workingDir: os.tmpdir(),
          name: `WS Test on ${remote.name}`,
          remoteId: remote.id,
        }),
      });
      const { sessionId } = await response.json();
      sessionIds.push(sessionId);
    }

    // Connect to WebSocket
    const ws = new WebSocket(`ws://localhost:${hqServer?.port}/buffers`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
      },
    });

    const receivedBuffers = new Set<string>();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket test timeout'));
      }, 10000);

      ws.on('open', () => {
        console.log(`[WS Test] WebSocket connected, subscribing to ${sessionIds.length} sessions`);
        // Subscribe to all sessions
        for (const sessionId of sessionIds) {
          console.log(`[WS Test] Subscribing to session: ${sessionId}`);
          ws.send(JSON.stringify({ type: 'subscribe', sessionId }));
        }
      });

      ws.on('message', (data: Buffer) => {
        console.log(
          `[WS Test] Received message, first byte: 0x${data[0].toString(16)}, length: ${data.length}`
        );
        if (data[0] === 0xbf) {
          // Binary buffer update
          const sessionIdLength = data.readUInt32LE(1);
          const sessionId = data.subarray(5, 5 + sessionIdLength).toString('utf8');
          console.log(`[WS Test] Received buffer update for session: ${sessionId}`);
          receivedBuffers.add(sessionId);

          if (receivedBuffers.size >= sessionIds.length) {
            clearTimeout(timeout);
            resolve();
          }
        } else {
          // JSON message
          try {
            const msg = JSON.parse(data.toString());
            console.log(`[WS Test] Received JSON message:`, msg);
            if (msg.type === 'ping') {
              ws.send(JSON.stringify({ type: 'pong' }));
            }
          } catch (_e) {
            // Ignore parse errors
          }
        }
      });

      ws.on('error', reject);
    });

    ws.close();
    expect(receivedBuffers.size).toBe(sessionIds.length);
  });

  it('should cleanup exited sessions across all servers', async () => {
    // Create sessions that will exit immediately
    const remotesResponse = await fetch(`http://localhost:${hqServer?.port}/api/remotes`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
      },
    });
    const remotes = await remotesResponse.json();

    for (const remote of remotes) {
      await fetch(`http://localhost:${hqServer?.port}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
        },
        body: JSON.stringify({
          command: ['echo', 'exit immediately'],
          workingDir: os.tmpdir(),
          remoteId: remote.id,
        }),
      });
    }

    // Wait for sessions to exit
    await sleep(2000);

    // Run cleanup
    const cleanupResponse = await fetch(`http://localhost:${hqServer?.port}/api/cleanup-exited`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
      },
    });

    expect(cleanupResponse.ok).toBe(true);
    const cleanupResult = await cleanupResponse.json();
    expect(cleanupResult.success).toBe(true);
    expect(cleanupResult.remoteResults).toBeDefined();
    expect(cleanupResult.remoteResults.length).toBe(3);
  });
});
