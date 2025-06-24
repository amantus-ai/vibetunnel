import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(port: number, maxRetries = 30): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`http://localhost:${port}/api/health`);
      if (response.ok) {
        return;
      }
    } catch (e) {
      // Server not ready yet
    }
    await sleep(100);
  }
  throw new Error(`Server on port ${port} did not start within ${maxRetries * 100}ms`);
}

async function startServer(
  args: string[] = [],
  env: Record<string, string> = {}
): Promise<{ process: ChildProcess; port: number }> {
  const cliPath = path.join(process.cwd(), 'src', 'index.ts');

  return new Promise((resolve, reject) => {
    const serverProcess = spawn('npx', ['tsx', cliPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let port = 0;
    const portListener = (data: Buffer) => {
      const output = data.toString();
      const portMatch = output.match(/Server listening on port (\d+)/);
      if (portMatch) {
        port = parseInt(portMatch[1], 10);
        serverProcess.stdout?.off('data', portListener);
        resolve({ process: serverProcess, port });
      }
    };

    serverProcess.stdout?.on('data', portListener);
    serverProcess.stderr?.on('data', (data) => {
      console.error(`Server stderr: ${data}`);
    });

    serverProcess.on('error', reject);

    setTimeout(() => {
      if (port === 0) {
        reject(new Error('Server did not report port within timeout'));
      }
    }, 5000);
  });
}

describe('Sessions API Tests', () => {
  let serverProcess: ChildProcess;
  let serverPort: number;
  let testDir: string;
  const username = 'testuser';
  const password = 'testpass';
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  beforeAll(async () => {
    // Create temporary directory for test
    testDir = path.join(os.tmpdir(), 'vibetunnel-sessions-test', Date.now().toString());
    fs.mkdirSync(testDir, { recursive: true });

    // Start server
    const result = await startServer(['--port', '0'], {
      VIBETUNNEL_CONTROL_DIR: testDir,
      VIBETUNNEL_USERNAME: username,
      VIBETUNNEL_PASSWORD: password,
    });

    serverProcess = result.process;
    serverPort = result.port;

    await waitForServer(serverPort);
  });

  afterAll(async () => {
    // Kill server process
    if (serverProcess) {
      await new Promise<void>((resolve) => {
        serverProcess.on('close', () => resolve());

        // Try graceful shutdown first
        serverProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (serverProcess.exitCode === null) {
            serverProcess.kill('SIGKILL');
          }
        }, 5000);
      });
    }

    // Clean up test directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (e) {
      console.error('Failed to clean test directory:', e);
    }
  });

  describe('GET /api/sessions', () => {
    it('should return empty array when no sessions exist', async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/sessions`, {
        headers: { Authorization: authHeader },
      });

      expect(response.status).toBe(200);
      const sessions = await response.json();
      expect(sessions).toEqual([]);
    });

    it('should require authentication', async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/sessions`);
      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/sessions', () => {
    it('should create a new session', async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/sessions`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['echo', 'hello world'],
          workingDir: testDir,
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result).toHaveProperty('sessionId');
      expect(result.sessionId).toMatch(/^[a-f0-9]{8}$/);
    });

    it('should create session with custom id', async () => {
      const customId = 'test1234';
      const response = await fetch(`http://localhost:${serverPort}/api/sessions`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['echo', 'custom id test'],
          workingDir: testDir,
          sessionId: customId,
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.sessionId).toBe(customId);
    });

    it('should create session with name', async () => {
      const sessionName = 'Test Session';
      const response = await fetch(`http://localhost:${serverPort}/api/sessions`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['echo', 'named session'],
          workingDir: testDir,
          name: sessionName,
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();

      // Verify session was created with the name
      const listResponse = await fetch(`http://localhost:${serverPort}/api/sessions`, {
        headers: { Authorization: authHeader },
      });
      const sessions = await listResponse.json();
      const createdSession = sessions.find((s: any) => s.id === result.sessionId);
      expect(createdSession?.name).toBe(sessionName);
    });

    it('should reject invalid working directory', async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/sessions`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['echo', 'test'],
          workingDir: '/nonexistent/directory',
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('Session lifecycle', () => {
    let sessionId: string;

    beforeAll(async () => {
      // Create a long-running session
      const response = await fetch(`http://localhost:${serverPort}/api/sessions`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['bash', '-c', 'while true; do echo "running"; sleep 1; done'],
          workingDir: testDir,
          name: 'Long Running Test',
        }),
      });

      const result = await response.json();
      sessionId = result.sessionId;

      // Wait for session to start
      await sleep(500);
    });

    it('should list the created session', async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/sessions`, {
        headers: { Authorization: authHeader },
      });

      expect(response.status).toBe(200);
      const sessions = await response.json();

      const session = sessions.find((s: any) => s.id === sessionId);
      expect(session).toBeDefined();
      expect(session.name).toBe('Long Running Test');
      expect(session.status).toBe('running');
      expect(session.cmdline).toEqual([
        'bash',
        '-c',
        'while true; do echo "running"; sleep 1; done',
      ]);
    });

    it('should send input to session', async () => {
      const response = await fetch(
        `http://localhost:${serverPort}/api/sessions/${sessionId}/input`,
        {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: 'echo "test input"\n' }),
        }
      );

      expect(response.status).toBe(204);
    });

    it('should resize session', async () => {
      const response = await fetch(
        `http://localhost:${serverPort}/api/sessions/${sessionId}/resize`,
        {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ cols: 120, rows: 40 }),
        }
      );

      expect(response.status).toBe(204);
    });

    it('should get session text', async () => {
      const response = await fetch(
        `http://localhost:${serverPort}/api/sessions/${sessionId}/text`,
        {
          headers: { Authorization: authHeader },
        }
      );

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('running');
    });

    it('should get session text with styles', async () => {
      const response = await fetch(
        `http://localhost:${serverPort}/api/sessions/${sessionId}/text?styles=true`,
        {
          headers: { Authorization: authHeader },
        }
      );

      expect(response.status).toBe(200);
      const text = await response.text();
      // Should contain style markup if terminal has any styled output
      expect(text).toBeDefined();
    });

    it('should get session buffer', async () => {
      const response = await fetch(
        `http://localhost:${serverPort}/api/sessions/${sessionId}/buffer`,
        {
          headers: { Authorization: authHeader },
        }
      );

      expect(response.status).toBe(200);
      const buffer = await response.arrayBuffer();

      // Check binary format header
      const view = new DataView(buffer);
      expect(view.getUint16(0)).toBe(0x5654); // Magic bytes "VT"
      expect(view.getUint8(2)).toBe(1); // Version
    });

    it('should get session activity', async () => {
      const response = await fetch(
        `http://localhost:${serverPort}/api/sessions/${sessionId}/activity`,
        {
          headers: { Authorization: authHeader },
        }
      );

      expect(response.status).toBe(200);
      const activity = await response.json();

      expect(activity).toHaveProperty('isActive');
      expect(activity).toHaveProperty('timestamp');
      expect(activity).toHaveProperty('session');
      expect(activity.session.cmdline).toEqual([
        'bash',
        '-c',
        'while true; do echo "running"; sleep 1; done',
      ]);
    });

    it('should get all sessions activity', async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/sessions/activity`, {
        headers: { Authorization: authHeader },
      });

      expect(response.status).toBe(200);
      const activities = await response.json();

      expect(activities).toHaveProperty(sessionId);
      expect(activities[sessionId]).toHaveProperty('isActive');
      expect(activities[sessionId]).toHaveProperty('timestamp');
    });

    it('should handle SSE stream', async () => {
      const response = await fetch(
        `http://localhost:${serverPort}/api/sessions/${sessionId}/stream`,
        {
          headers: {
            Authorization: authHeader,
            Accept: 'text/event-stream',
          },
        }
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/event-stream');

      // Read a few events
      const reader = response.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let buffer = '';
        let eventCount = 0;

        while (eventCount < 3) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n').filter((e) => e.trim());
          eventCount += events.length;
        }

        reader.cancel();
        expect(eventCount).toBeGreaterThan(0);
      }
    });

    it('should kill session', async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: authHeader },
      });

      expect(response.status).toBe(204);

      // Wait for session to be killed
      await sleep(1000);

      // Verify session is gone
      const listResponse = await fetch(`http://localhost:${serverPort}/api/sessions`, {
        headers: { Authorization: authHeader },
      });
      const sessions = await listResponse.json();
      const killedSession = sessions.find((s: any) => s.id === sessionId);
      expect(killedSession).toBeUndefined();
    });
  });

  describe('Error handling', () => {
    it('should return 404 for non-existent session', async () => {
      const response = await fetch(
        `http://localhost:${serverPort}/api/sessions/nonexistent/input`,
        {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: 'test' }),
        }
      );

      expect(response.status).toBe(404);
    });

    it('should handle invalid input data', async () => {
      // Create a session first
      const createResponse = await fetch(`http://localhost:${serverPort}/api/sessions`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['cat'],
          workingDir: testDir,
        }),
      });

      const result = await createResponse.json();
      const sessionId = result.sessionId;

      // Send invalid input (missing data field)
      const response = await fetch(
        `http://localhost:${serverPort}/api/sessions/${sessionId}/input`,
        {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      );

      expect(response.status).toBe(400);
    });

    it('should handle invalid resize dimensions', async () => {
      // Create a session first
      const createResponse = await fetch(`http://localhost:${serverPort}/api/sessions`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['cat'],
          workingDir: testDir,
        }),
      });

      const result = await createResponse.json();
      const sessionId = result.sessionId;

      // Send invalid resize (negative dimensions)
      const response = await fetch(
        `http://localhost:${serverPort}/api/sessions/${sessionId}/resize`,
        {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ cols: -1, rows: 40 }),
        }
      );

      expect(response.status).toBe(400);
    });
  });
});
