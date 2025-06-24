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

describe('Logs API Tests', () => {
  let serverProcess: ChildProcess;
  let serverPort: number;
  let testDir: string;
  const username = 'testuser';
  const password = 'testpass';
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  beforeAll(async () => {
    // Create temporary directory for test
    testDir = path.join(os.tmpdir(), 'vibetunnel-logs-test', Date.now().toString());
    fs.mkdirSync(testDir, { recursive: true });

    // Start server with debug logging enabled
    const result = await startServer(['--port', '0'], {
      VIBETUNNEL_CONTROL_DIR: testDir,
      VIBETUNNEL_USERNAME: username,
      VIBETUNNEL_PASSWORD: password,
      VIBETUNNEL_DEBUG: '1',
    });

    serverProcess = result.process;
    serverPort = result.port;

    await waitForServer(serverPort);

    // Wait a bit for initial logs to be written
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
    } catch (e) {
      console.error('Failed to clean test directory:', e);
    }
  });

  describe('POST /api/logs/client', () => {
    it('should accept client logs', async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/logs/client`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          level: 'log',
          module: 'test-module',
          args: ['Test log message', { extra: 'data' }],
        }),
      });

      expect(response.status).toBe(204);
    });

    it('should accept different log levels', async () => {
      const levels = ['log', 'warn', 'error', 'debug'];

      for (const level of levels) {
        const response = await fetch(`http://localhost:${serverPort}/api/logs/client`, {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            level,
            module: 'test-module',
            args: [`Test ${level} message`],
          }),
        });

        expect(response.status).toBe(204);
      }
    });

    it('should require authentication', async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/logs/client`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          level: 'log',
          module: 'test',
          args: ['test'],
        }),
      });

      expect(response.status).toBe(401);
    });

    it('should validate request body', async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/logs/client`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Missing required fields
          args: ['test'],
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/logs/info', () => {
    it('should return log file information', async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/logs/info`, {
        headers: { Authorization: authHeader },
      });

      expect(response.status).toBe(200);
      const info = await response.json();

      expect(info).toHaveProperty('exists');
      expect(info).toHaveProperty('size');
      expect(info).toHaveProperty('lastModified');
      expect(info).toHaveProperty('path');

      expect(info.exists).toBe(true);
      expect(info.size).toBeGreaterThan(0);
      expect(info.path).toContain('log.txt');
    });

    it('should require authentication', async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/logs/info`);
      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/logs/raw', () => {
    it('should stream log file content', async () => {
      // Add some client logs first
      await fetch(`http://localhost:${serverPort}/api/logs/client`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          level: 'log',
          module: 'test-raw',
          args: ['This is a test log for raw endpoint'],
        }),
      });

      // Wait for log to be written
      await sleep(100);

      const response = await fetch(`http://localhost:${serverPort}/api/logs/raw`, {
        headers: { Authorization: authHeader },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');

      const content = await response.text();
      expect(content).toContain('Server started');
      expect(content).toContain('CLIENT:test-raw');
      expect(content).toContain('This is a test log for raw endpoint');
    });

    it('should require authentication', async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/logs/raw`);
      expect(response.status).toBe(401);
    });
  });

  describe('DELETE /api/logs/clear', () => {
    it('should clear the log file', async () => {
      // First, verify log file has content
      const infoResponse = await fetch(`http://localhost:${serverPort}/api/logs/info`, {
        headers: { Authorization: authHeader },
      });
      const infoBefore = await infoResponse.json();
      expect(infoBefore.size).toBeGreaterThan(0);

      // Clear logs
      const clearResponse = await fetch(`http://localhost:${serverPort}/api/logs/clear`, {
        method: 'DELETE',
        headers: { Authorization: authHeader },
      });
      expect(clearResponse.status).toBe(204);

      // Wait for file operation
      await sleep(100);

      // Verify log file is empty or very small (might have new startup logs)
      const infoAfterResponse = await fetch(`http://localhost:${serverPort}/api/logs/info`, {
        headers: { Authorization: authHeader },
      });
      const infoAfter = await infoAfterResponse.json();

      // Log file should be much smaller after clearing
      expect(infoAfter.size).toBeLessThan(infoBefore.size);
    });

    it('should require authentication', async () => {
      const response = await fetch(`http://localhost:${serverPort}/api/logs/clear`, {
        method: 'DELETE',
      });
      expect(response.status).toBe(401);
    });
  });

  describe('Log file format', () => {
    it('should format logs correctly', async () => {
      // Submit a test log
      const testTimestamp = new Date().toISOString();
      await fetch(`http://localhost:${serverPort}/api/logs/client`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          level: 'warn',
          module: 'format-test',
          args: ['Test warning message', { details: 'test object' }],
        }),
      });

      // Wait for log to be written
      await sleep(200);

      // Read raw logs
      const response = await fetch(`http://localhost:${serverPort}/api/logs/raw`, {
        headers: { Authorization: authHeader },
      });
      const logs = await response.text();

      // Check log format
      const lines = logs.split('\n');
      const testLogLine = lines.find((line) => line.includes('CLIENT:format-test'));

      expect(testLogLine).toBeDefined();
      expect(testLogLine).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/); // Timestamp format
      expect(testLogLine).toContain('[warn]');
      expect(testLogLine).toContain('[CLIENT:format-test]');
      expect(testLogLine).toContain('Test warning message');
      expect(testLogLine).toContain('{"details":"test object"}');
    });
  });
});
