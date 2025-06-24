import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

describe('Server Smoke Test', () => {
  let serverProcess: ChildProcess | null = null;
  let serverPort = 0;
  // Use shorter directory name to avoid exceeding Unix socket path limit (104 chars on macOS)
  const testDir = path.join(os.tmpdir(), 'vt-test', uuidv4().substring(0, 8));

  async function startServer(): Promise<number> {
    const cliPath = path.join(__dirname, '..', '..', 'cli.ts');

    serverProcess = spawn('tsx', [cliPath, '--port', '0'], {
      env: {
        ...process.env,
        VIBETUNNEL_CONTROL_DIR: testDir,
        VIBETUNNEL_USERNAME: undefined,
        VIBETUNNEL_PASSWORD: undefined,
        NODE_ENV: 'production',
        FORCE_COLOR: '0',
      },
      stdio: 'pipe',
      detached: false, // Ensure child dies with parent
    });

    return new Promise((resolve, reject) => {
      let outputBuffer = '';
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          reject(new Error('Server failed to start within timeout'));
        }
      }, 10000);

      if (serverProcess && serverProcess.stdout) {
        serverProcess.stdout.on('data', (data) => {
          const chunk = data.toString();
          outputBuffer += chunk;
          console.log(`[SERVER] ${chunk.trim()}`);

          // Extract port from output
          const portMatch = outputBuffer.match(
            /VibeTunnel Server running on http:\/\/localhost:(\d+)/
          );
          if (portMatch && !resolved) {
            resolved = true;
            clearTimeout(timeout);
            const port = parseInt(portMatch[1]);
            resolve(port);
          }
        });
      }

      if (serverProcess && serverProcess.stderr) {
        serverProcess.stderr.on('data', (data) => {
          console.error(`[SERVER ERROR] ${data.toString().trim()}`);
        });
      }

      if (serverProcess) {
        serverProcess.on('error', (err) => {
          if (!resolved) {
            clearTimeout(timeout);
            reject(err);
          }
        });

        serverProcess.on('exit', (code, signal) => {
          if (!resolved) {
            clearTimeout(timeout);
            reject(new Error(`Server exited with code ${code}, signal ${signal}`));
          }
        });
      }
    });
  }

  beforeAll(async () => {
    // Create test directory
    fs.mkdirSync(testDir, { recursive: true });

    // Start server
    serverPort = await startServer();
    console.log(`Server started on port ${serverPort}`);
  });

  afterAll(async () => {
    // Kill server
    if (serverProcess) {
      // First try SIGTERM
      serverProcess.kill('SIGTERM');

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          console.log('[TEST] Force killing server process');
          try {
            if (serverProcess) {
              serverProcess.kill('SIGKILL');
            }
          } catch (_e) {
            // Process may already be dead
          }
          resolve();
        }, 5000);

        const checkExit = () => {
          if (serverProcess && (serverProcess.killed || serverProcess.exitCode !== null)) {
            clearTimeout(timeout);
            resolve();
          }
        };

        // Check if already exited
        checkExit();

        // Set up exit listener
        if (serverProcess) {
          serverProcess.once('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        }
      });
    }

    // Clean up test directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (e) {
      console.error('Failed to clean up test directory:', e);
    }
  });

  it('should perform basic operations', async () => {
    const baseUrl = `http://localhost:${serverPort}`;

    // 1. Health check
    console.log('1. Testing health check...');
    const healthResponse = await fetch(`${baseUrl}/api/health`);
    expect(healthResponse.ok).toBe(true);
    const health = await healthResponse.json();
    expect(health.status).toBe('ok');

    // 2. List sessions (should be empty)
    console.log('2. Listing sessions...');
    const listResponse = await fetch(`${baseUrl}/api/sessions`);
    expect(listResponse.ok).toBe(true);
    const sessions = await listResponse.json();
    expect(sessions).toEqual([]);

    // 3. Create a session
    console.log('3. Creating session...');
    const createResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: ['sh', '-c', 'echo "hello world"; sleep 2'],
        options: {
          sessionName: 'test-session',
          cols: 80,
          rows: 24,
        },
      }),
    });
    expect(createResponse.ok).toBe(true);
    const createResult = await createResponse.json();
    expect(createResult.sessionId).toBeDefined();
    const sessionId = createResult.sessionId;
    console.log(`Created session: ${sessionId}`);

    // 4. Send input
    console.log('4. Sending input...');
    const inputResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '\n' }),
    });
    expect(inputResponse.ok).toBe(true);

    // Wait a bit for the command to execute
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    // 5. Get buffer
    console.log('5. Getting buffer...');
    const bufferResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}/buffer`);
    expect(bufferResponse.ok).toBe(true);
    expect(bufferResponse.headers.get('content-type')).toBe('application/octet-stream');
    const buffer = await bufferResponse.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
    console.log(`Buffer size: ${buffer.byteLength} bytes`);

    // 6. List sessions again (should have one)
    console.log('6. Listing sessions again...');
    const listResponse2 = await fetch(`${baseUrl}/api/sessions`);
    expect(listResponse2.ok).toBe(true);
    const sessions2 = await listResponse2.json();
    expect(sessions2.length).toBe(1);
    expect(sessions2[0].id).toBe(sessionId);

    // 7. Kill session
    console.log('7. Killing session...');
    const killResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    expect(killResponse.ok).toBe(true);

    // Wait for session to be cleaned up
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    // 8. Verify session is gone
    console.log('8. Verifying session is gone...');
    const listResponse3 = await fetch(`${baseUrl}/api/sessions`);
    expect(listResponse3.ok).toBe(true);
    const sessions3 = await listResponse3.json();
    // Session might still exist but marked as exited
    const session = sessions3.find((s: { id: string }) => s.id === sessionId);
    if (session) {
      expect(session.status).toBe('exited');
    }

    console.log('All tests passed!');
  });
});
