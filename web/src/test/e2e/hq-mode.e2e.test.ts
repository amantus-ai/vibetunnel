import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';

describe('HQ Mode E2E Tests', () => {
  let hqProcess: ChildProcess | null = null;
  const remoteProcesses: ChildProcess[] = [];
  let hqPort = 0;
  const remotePorts: number[] = [];
  const hqUsername = 'hq-admin';
  const hqPassword = 'hq-pass123';
  const testDirs: string[] = [];
  // Use shorter directory name to avoid exceeding Unix socket path limit (104 chars on macOS)
  const baseDir = path.join(os.tmpdir(), 'vt-hq', uuidv4().substring(0, 8));

  async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForServer(
    port: number,
    username?: string,
    password?: string,
    maxAttempts = 30
  ): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const headers: Record<string, string> = {};
        if (username && password) {
          headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
        }

        const response = await fetch(`http://localhost:${port}/api/health`, { headers });
        if (response.ok) {
          return true;
        }
      } catch (_e: unknown) {
        // Server not ready yet
      }
      await sleep(1000);
    }
    return false;
  }

  async function startServer(
    args: string[],
    env: Record<string, string>
  ): Promise<{ process: ChildProcess; port: number }> {
    const cliPath = path.join(__dirname, '..', '..', 'cli.ts');
    console.log(`[DEBUG] Starting server at: ${cliPath}`);
    console.log(`[DEBUG] Args: ${args.join(' ')}`);

    const serverProcess = spawn('tsx', [cliPath, ...args], {
      env: { ...process.env, ...env, NODE_ENV: 'production', FORCE_COLOR: '0' },
      stdio: 'pipe',
      detached: false, // Ensure child dies with parent
    });

    return new Promise((resolve, reject) => {
      let port = 0;
      let resolved = false;

      let outputBuffer = '';
      serverProcess.stdout?.on('data', (data) => {
        const chunk = data.toString();
        outputBuffer += chunk;
        console.log(`[SERVER OUTPUT] ${chunk.trim()}`);

        // Extract port from "VibeTunnel Server running on" message
        const portMatch = outputBuffer.match(
          /VibeTunnel Server running on http:\/\/localhost:(\d+)/
        );
        if (portMatch && !resolved) {
          port = parseInt(portMatch[1]);
          resolved = true;
          resolve({ process: serverProcess, port });
        }
      });

      serverProcess.stderr?.on('data', (data) => {
        console.error(`[SERVER ERROR] ${data.toString().trim()}`);
      });

      serverProcess.on('error', (err) => {
        console.error(`[SERVER ERROR EVENT] ${err}`);
        reject(err);
      });

      serverProcess.on('exit', (code, signal) => {
        console.error(`[SERVER EXIT] code: ${code}, signal: ${signal}`);
        if (!resolved) {
          reject(new Error(`Server exited with code ${code}`));
        }
      });

      // Timeout after 10 seconds
      setTimeout(() => reject(new Error('Server failed to start within timeout')), 10000);
    });
  }

  beforeAll(async () => {
    // Start HQ server
    const hqDir = path.join(baseDir, 'hq');
    fs.mkdirSync(hqDir, { recursive: true });
    testDirs.push(hqDir);

    const hqResult = await startServer(
      ['--port', '0', '--hq', '--username', hqUsername, '--password', hqPassword],
      {
        VIBETUNNEL_CONTROL_DIR: hqDir,
      }
    );
    hqProcess = hqResult.process;
    hqPort = hqResult.port;

    expect(hqPort).toBeGreaterThan(0);

    // Start remote servers
    for (let i = 0; i < 3; i++) {
      const remoteDir = path.join(baseDir, `remote-${i}`);
      fs.mkdirSync(remoteDir, { recursive: true });
      testDirs.push(remoteDir);

      const remoteResult = await startServer(
        [
          '--port',
          '0',
          '--username',
          `remote${i}`,
          '--password',
          `remotepass${i}`,
          '--hq-url',
          `http://localhost:${hqPort}`,
          '--hq-username',
          hqUsername,
          '--hq-password',
          hqPassword,
          '--name',
          `remote-${i}`,
          '--allow-insecure-hq',
        ],
        {
          VIBETUNNEL_CONTROL_DIR: remoteDir,
        }
      );

      remoteProcesses.push(remoteResult.process);
      remotePorts.push(remoteResult.port);
      expect(remoteResult.port).toBeGreaterThan(0);
      expect(remoteResult.port).not.toBe(hqPort);
    }

    // Wait for HQ server to be ready
    const hqReady = await waitForServer(hqPort, hqUsername, hqPassword);
    expect(hqReady).toBe(true);

    // Wait for all remote servers to be ready
    for (let i = 0; i < remotePorts.length; i++) {
      const remoteReady = await waitForServer(remotePorts[i], `remote${i}`, `remotepass${i}`);
      expect(remoteReady).toBe(true);
    }

    // Wait for registration to complete
    await sleep(2000);
  }, 60000); // 60 second timeout for setup

  afterAll(async () => {
    // Helper to properly kill a process
    const killProcess = async (proc: ChildProcess | null, name: string) => {
      if (!proc) return;

      return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          console.log(`[TEST] Force killing ${name} process`);
          try {
            proc.kill('SIGKILL');
          } catch (_e) {
            // Process may already be dead
          }
          resolve();
        }, 5000);

        const checkExit = () => {
          if (proc.killed || proc.exitCode !== null) {
            clearTimeout(timeout);
            resolve();
          }
        };

        // Check if already exited
        checkExit();

        // Set up exit listener
        proc.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });

        // Try SIGTERM first
        try {
          proc.kill('SIGTERM');
        } catch (_e) {
          // Process may already be dead
        }
      });
    };

    // Kill all remote processes
    await Promise.all(remoteProcesses.map((proc, i) => killProcess(proc, `remote-${i}`)));

    // Kill HQ process
    await killProcess(hqProcess, 'HQ');

    // Clean up directories
    for (const dir of testDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (_e) {
        // Ignore cleanup errors
      }
    }
  }, 30000); // 30 second timeout for cleanup

  it('should list all registered remotes', async () => {
    const response = await fetch(`http://localhost:${hqPort}/api/remotes`, {
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
      expect(remote.url).toBe(`http://localhost:${remotePorts[i]}`);
    }
  });

  it('should create sessions on remote servers', async () => {
    const sessionIds: string[] = [];

    // Get remotes
    const remotesResponse = await fetch(`http://localhost:${hqPort}/api/remotes`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
      },
    });
    const remotes = await remotesResponse.json();

    // Create session on each remote
    for (const remote of remotes) {
      const response = await fetch(`http://localhost:${hqPort}/api/sessions`, {
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
    const allSessionsResponse = await fetch(`http://localhost:${hqPort}/api/sessions`, {
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
    const remotesResponse = await fetch(`http://localhost:${hqPort}/api/remotes`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
      },
    });
    const remotes = await remotesResponse.json();
    const remote = remotes[0];

    // Create session on remote
    const createResponse = await fetch(`http://localhost:${hqPort}/api/sessions`, {
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
    const infoResponse = await fetch(`http://localhost:${hqPort}/api/sessions/${sessionId}`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
      },
    });

    expect(infoResponse.ok).toBe(true);
    const sessionInfo = await infoResponse.json();
    expect(sessionInfo.id).toBe(sessionId);
    expect(sessionInfo.name).toBe('Proxy Test Session');

    // Send input through HQ
    const inputResponse = await fetch(
      `http://localhost:${hqPort}/api/sessions/${sessionId}/input`,
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
    const killResponse = await fetch(`http://localhost:${hqPort}/api/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
      },
    });
    expect(killResponse.ok).toBe(true);
  });

  it('should aggregate buffer updates through WebSocket', async () => {
    const sessionIds: string[] = [];

    // Create sessions for WebSocket test
    const remotesResponse = await fetch(`http://localhost:${hqPort}/api/remotes`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
      },
    });
    const remotes = await remotesResponse.json();

    for (const remote of remotes) {
      const response = await fetch(`http://localhost:${hqPort}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
        },
        body: JSON.stringify({
          command: [
            'bash',
            '-c',
            `for i in {1..3}; do echo "${remote.name} message $i"; sleep 0.1; done`,
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
    const ws = new WebSocket(`ws://localhost:${hqPort}/buffers`, {
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
        // Subscribe to all sessions
        for (const sessionId of sessionIds) {
          ws.send(JSON.stringify({ type: 'subscribe', sessionId }));
        }
      });

      ws.on('message', (data: Buffer) => {
        if (data[0] === 0xbf) {
          // Binary buffer update
          const sessionIdLength = data.readUInt32LE(1);
          const sessionId = data.subarray(5, 5 + sessionIdLength).toString('utf8');
          receivedBuffers.add(sessionId);

          if (receivedBuffers.size >= sessionIds.length) {
            clearTimeout(timeout);
            resolve();
          }
        } else {
          // JSON message
          try {
            const msg = JSON.parse(data.toString());
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
    const remotesResponse = await fetch(`http://localhost:${hqPort}/api/remotes`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${hqUsername}:${hqPassword}`).toString('base64')}`,
      },
    });
    const remotes = await remotesResponse.json();

    for (const remote of remotes) {
      await fetch(`http://localhost:${hqPort}/api/sessions`, {
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
    const cleanupResponse = await fetch(`http://localhost:${hqPort}/api/cleanup-exited`, {
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
