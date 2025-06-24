import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ServerInstance, startTestServer, stopServer } from '../utils/server-utils';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Logs API Tests', () => {
  let server: ServerInstance | null = null;
  const username = 'testuser';
  const password = 'testpass';
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  beforeAll(async () => {
    // Start server with debug logging enabled
    server = await startTestServer({
      args: ['--port', '0'],
      env: {
        VIBETUNNEL_USERNAME: username,
        VIBETUNNEL_PASSWORD: password,
        VIBETUNNEL_DEBUG: '1',
      },
      waitForHealth: true,
    });

    // Wait a bit for initial logs to be written
    await sleep(500);
  });

  afterAll(async () => {
    if (server) {
      await stopServer(server);
    }
  });

  describe('POST /api/logs/client', () => {
    it('should accept client logs', async () => {
      const response = await fetch(`http://localhost:${server?.port}/api/logs/client`, {
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
        const response = await fetch(`http://localhost:${server?.port}/api/logs/client`, {
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
      const response = await fetch(`http://localhost:${server?.port}/api/logs/client`, {
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
      const response = await fetch(`http://localhost:${server?.port}/api/logs/client`, {
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
      const response = await fetch(`http://localhost:${server?.port}/api/logs/info`, {
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
      const response = await fetch(`http://localhost:${server?.port}/api/logs/info`);
      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/logs/raw', () => {
    it('should stream log file content', async () => {
      // Add some client logs first
      await fetch(`http://localhost:${server?.port}/api/logs/client`, {
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

      const response = await fetch(`http://localhost:${server?.port}/api/logs/raw`, {
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
      const response = await fetch(`http://localhost:${server?.port}/api/logs/raw`);
      expect(response.status).toBe(401);
    });
  });

  describe('DELETE /api/logs/clear', () => {
    it('should clear the log file', async () => {
      // First, verify log file has content
      const infoResponse = await fetch(`http://localhost:${server?.port}/api/logs/info`, {
        headers: { Authorization: authHeader },
      });
      const infoBefore = await infoResponse.json();
      expect(infoBefore.size).toBeGreaterThan(0);

      // Clear logs
      const clearResponse = await fetch(`http://localhost:${server?.port}/api/logs/clear`, {
        method: 'DELETE',
        headers: { Authorization: authHeader },
      });
      expect(clearResponse.status).toBe(204);

      // Wait for file operation
      await sleep(100);

      // Verify log file is empty or very small (might have new startup logs)
      const infoAfterResponse = await fetch(`http://localhost:${server?.port}/api/logs/info`, {
        headers: { Authorization: authHeader },
      });
      const infoAfter = await infoAfterResponse.json();

      // Log file should be much smaller after clearing
      expect(infoAfter.size).toBeLessThan(infoBefore.size);
    });

    it('should require authentication', async () => {
      const response = await fetch(`http://localhost:${server?.port}/api/logs/clear`, {
        method: 'DELETE',
      });
      expect(response.status).toBe(401);
    });
  });

  describe('Log file format', () => {
    it('should format logs correctly', async () => {
      // Submit a test log
      await fetch(`http://localhost:${server?.port}/api/logs/client`, {
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
      const response = await fetch(`http://localhost:${server?.port}/api/logs/raw`, {
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
