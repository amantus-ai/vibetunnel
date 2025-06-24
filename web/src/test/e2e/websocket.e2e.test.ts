import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import WebSocket from 'ws';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(port: number, maxRetries = 30): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`http://localhost:${port}/api/health`);
      if (response.ok) {
        return;
      }
    } catch (_e) {
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
  const cliPath = path.join(process.cwd(), 'src', 'cli.ts');

  return new Promise((resolve, reject) => {
    const serverProcess = spawn('npx', ['tsx', cliPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let port = 0;
    const portListener = (data: Buffer) => {
      const output = data.toString();
      const portMatch = output.match(/VibeTunnel Server running on http:\/\/localhost:(\d+)/);
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

describe('WebSocket Buffer Tests', () => {
  let serverProcess: ChildProcess;
  let serverPort: number;
  let testDir: string;
  let sessionId: string;
  const username = 'testuser';
  const password = 'testpass';
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  beforeAll(async () => {
    // Create temporary directory for test
    testDir = path.join(os.tmpdir(), 'vibetunnel-ws-test', Date.now().toString());
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

    // Create a test session
    const createResponse = await fetch(`http://localhost:${serverPort}/api/sessions`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        command: ['bash', '-c', 'while true; do echo "test output $RANDOM"; sleep 1; done'],
        workingDir: testDir,
        name: 'WebSocket Test Session',
      }),
    });

    const createResult = await createResponse.json();
    sessionId = createResult.sessionId;

    // Wait for session to start
    await sleep(500);
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
    } catch (_e) {
      console.error('Failed to clean test directory:', _e);
    }
  });

  describe('WebSocket Connection', () => {
    it('should connect to WebSocket endpoint', async () => {
      const ws = new WebSocket(`ws://localhost:${serverPort}/buffers`, {
        headers: { Authorization: authHeader },
      });

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          resolve();
        });
        ws.on('error', reject);
      });

      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });

    it('should reject unauthorized connections', async () => {
      const ws = new WebSocket(`ws://localhost:${serverPort}/buffers`);

      await new Promise<void>((resolve) => {
        ws.on('error', () => {
          resolve();
        });
        ws.on('close', () => {
          resolve();
        });
      });

      expect(ws.readyState).toBe(WebSocket.CLOSED);
    });
  });

  describe('Buffer Subscription', () => {
    it('should subscribe to session buffers', async () => {
      const ws = new WebSocket(`ws://localhost:${serverPort}/buffers`, {
        headers: { Authorization: authHeader },
      });

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Subscribe to session
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          sessionId: sessionId,
        })
      );

      // Wait for buffer message
      const bufferMessage = await new Promise<Buffer>((resolve) => {
        ws.on('message', (data) => {
          resolve(data);
        });
      });

      expect(bufferMessage).toBeInstanceOf(Buffer);

      // Verify binary format header
      const buffer = bufferMessage as Buffer;
      
      // Check magic byte
      expect(buffer.readUInt8(0)).toBe(0xbf);
      
      // Read session ID length (4 bytes, little endian)
      const sessionIdLength = buffer.readUInt32LE(1);
      expect(sessionIdLength).toBe(sessionId.length);

      // Extract session ID
      const extractedSessionId = buffer.slice(5, 5 + sessionIdLength).toString('utf8');
      expect(extractedSessionId).toBe(sessionId);

      // Check terminal buffer format after session ID
      const terminalBufferStart = 5 + sessionIdLength;
      const terminalView = new DataView(buffer.buffer, buffer.byteOffset + terminalBufferStart);
      expect(terminalView.getUint16(0)).toBe(0x5654); // "VT"
      expect(terminalView.getUint8(2)).toBe(1); // Version

      ws.close();
    });

    it('should unsubscribe from session', async () => {
      const ws = new WebSocket(`ws://localhost:${serverPort}/buffers`, {
        headers: { Authorization: authHeader },
      });

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Subscribe first
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          sessionId: sessionId,
        })
      );

      // Wait for initial buffer
      await new Promise((resolve) => {
        ws.once('message', resolve);
      });

      // Unsubscribe
      ws.send(
        JSON.stringify({
          type: 'unsubscribe',
          sessionId: sessionId,
        })
      );

      // Should not receive more messages
      let receivedMessage = false;
      ws.on('message', () => {
        receivedMessage = true;
      });

      await sleep(2000); // Wait for potential messages
      expect(receivedMessage).toBe(false);

      ws.close();
    });

    it('should handle multiple subscriptions', async () => {
      // Create another session
      const createResponse = await fetch(`http://localhost:${serverPort}/api/sessions`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['bash', '-c', 'for i in {1..10}; do echo "session 2: $i"; sleep 0.5; done'],
          workingDir: testDir,
          name: 'Second Session',
        }),
      });

      const { sessionId: sessionId2 } = await createResponse.json();

      const ws = new WebSocket(`ws://localhost:${serverPort}/buffers`, {
        headers: { Authorization: authHeader },
      });

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Subscribe to both sessions
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          sessionId: sessionId,
        })
      );

      ws.send(
        JSON.stringify({
          type: 'subscribe',
          sessionId: sessionId2,
        })
      );

      // Collect messages from both sessions
      const receivedSessions = new Set<string>();
      const messagePromise = new Promise<void>((resolve) => {
        ws.on('message', (data: Buffer) => {
          // Skip if not a binary message
          if (data.readUInt8(0) !== 0xbf) return;
          
          const sessionIdLength = data.readUInt32LE(1);
          const extractedSessionId = data.slice(5, 5 + sessionIdLength).toString('utf8');
          receivedSessions.add(extractedSessionId);

          if (receivedSessions.size === 2) {
            resolve();
          }
        });
      });

      await messagePromise;

      expect(receivedSessions.has(sessionId)).toBe(true);
      expect(receivedSessions.has(sessionId2)).toBe(true);

      ws.close();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid message format', async () => {
      const ws = new WebSocket(`ws://localhost:${serverPort}/buffers`, {
        headers: { Authorization: authHeader },
      });

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Send invalid JSON
      ws.send('invalid json');

      // Connection should remain open
      await sleep(100);
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it('should handle subscription to non-existent session', async () => {
      const ws = new WebSocket(`ws://localhost:${serverPort}/buffers`, {
        headers: { Authorization: authHeader },
      });

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Subscribe to non-existent session
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          sessionId: 'nonexistent',
        })
      );

      // Should not receive any messages
      let receivedMessage = false;
      ws.on('message', () => {
        receivedMessage = true;
      });

      await sleep(1000);
      expect(receivedMessage).toBe(false);

      ws.close();
    });

    it('should handle missing sessionId in subscribe', async () => {
      const ws = new WebSocket(`ws://localhost:${serverPort}/buffers`, {
        headers: { Authorization: authHeader },
      });

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Send subscribe without sessionId
      ws.send(
        JSON.stringify({
          type: 'subscribe',
        })
      );

      // Connection should remain open
      await sleep(100);
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });
  });

  describe('Binary Protocol', () => {
    it('should encode terminal buffer correctly', async () => {
      // Send some input to generate specific output
      await fetch(`http://localhost:${serverPort}/api/sessions/${sessionId}/input`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: '\x1b[2J\x1b[H' }), // Clear screen
      });

      await sleep(100);

      await fetch(`http://localhost:${serverPort}/api/sessions/${sessionId}/input`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: 'echo "Hello WebSocket"\n' }),
      });

      await sleep(500);

      const ws = new WebSocket(`ws://localhost:${serverPort}/buffers`, {
        headers: { Authorization: authHeader },
      });

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Subscribe to session
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          sessionId: sessionId,
        })
      );

      // Get buffer message
      const bufferMessage = await new Promise<Buffer>((resolve) => {
        ws.on('message', (data: Buffer) => {
          resolve(data);
        });
      });

      // Parse binary format
      const sessionIdLength = bufferMessage.readUInt8(0);
      const headerStart = 1 + sessionIdLength;
      const view = new DataView(
        bufferMessage.buffer,
        bufferMessage.byteOffset + headerStart,
        bufferMessage.byteLength - headerStart
      );

      // Verify header
      expect(view.getUint16(0)).toBe(0x5654); // Magic "VT"
      expect(view.getUint8(2)).toBe(1); // Version

      // Read dimensions
      const cols = view.getUint32(4);
      const rows = view.getUint32(8);
      expect(cols).toBeGreaterThan(0);
      expect(rows).toBeGreaterThan(0);

      // Read cursor position
      const cursorX = view.getUint32(12);
      const cursorY = view.getUint32(16);
      expect(cursorX).toBeGreaterThanOrEqual(0);
      expect(cursorY).toBeGreaterThanOrEqual(0);

      ws.close();
    });
  });

  describe('Connection Lifecycle', () => {
    it('should handle client disconnect gracefully', async () => {
      const ws = new WebSocket(`ws://localhost:${serverPort}/buffers`, {
        headers: { Authorization: authHeader },
      });

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Subscribe to session
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          sessionId: sessionId,
        })
      );

      // Close connection
      ws.close();

      // Server should continue running
      await sleep(100);
      const healthResponse = await fetch(`http://localhost:${serverPort}/api/health`);
      expect(healthResponse.ok).toBe(true);
    });

    it('should handle rapid connect/disconnect', async () => {
      for (let i = 0; i < 5; i++) {
        const ws = new WebSocket(`ws://localhost:${serverPort}/buffers`, {
          headers: { Authorization: authHeader },
        });

        await new Promise<void>((resolve) => {
          ws.on('open', resolve);
        });

        ws.close();
        await sleep(50);
      }

      // Server should still be healthy
      const healthResponse = await fetch(`http://localhost:${serverPort}/api/health`);
      expect(healthResponse.ok).toBe(true);
    });
  });
});
