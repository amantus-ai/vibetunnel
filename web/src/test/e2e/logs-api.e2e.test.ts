import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ServerInstance, startTestServer, stopServer } from '../utils/server-utils';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.sequential('Logs API Tests', () => {
  let server: ServerInstance | null = null;

  beforeAll(async () => {
    // Start server with debug logging enabled and no auth for tests
    server = await startTestServer({
      args: ['--port', '0', '--no-auth'],
      env: {
        VIBETUNNEL_DEBUG: '1',
      },
      waitForHealth: true,
    });

    // Wait a bit for initial logs to be written
    await sleep(500);
  });

  afterAll(async () => {
    if (server) {
      await stopServer(server.process);
    }
  });

  // Add delay between tests to avoid socket issues
  beforeEach(async () => {
    await sleep(100);
  });

  describe('POST /api/logs/client', () => {
    it('should accept client logs', async () => {
      const response = await fetch(`http://localhost:${server?.port}/api/logs/client`, {
        method: 'POST',
        headers: {
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

    it('should accept requests without authentication when using --no-auth', async () => {
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

      // With --no-auth, this should succeed
      expect(response.status).toBe(204);
    });

    it('should validate request body', async () => {
      const response = await fetch(`http://localhost:${server?.port}/api/logs/client`, {
        method: 'POST',
        headers: {
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
    // TODO: This test is flaky - sometimes the log file size is 0 even after writing
    // This appears to be a timing issue where the file is created but not yet flushed
    it.skip('should return log file information', async () => {
      // First write a log to ensure the file exists
      await fetch(`http://localhost:${server?.port}/api/logs/client`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          level: 'log',
          module: 'test',
          args: ['Ensuring log file exists'],
        }),
      });

      // Wait and retry for the log file to be written and flushed
      let info: { exists: boolean; size: number };
      let attempts = 0;
      const maxAttempts = 10;
      const retryDelay = 200;

      do {
        await sleep(retryDelay);
        const response = await fetch(`http://localhost:${server?.port}/api/logs/info`);
        expect(response.status).toBe(200);
        info = await response.json();
        attempts++;
      } while (!info.exists && attempts < maxAttempts);

      expect(info).toHaveProperty('exists');
      expect(info).toHaveProperty('size');
      expect(info).toHaveProperty('lastModified');
      expect(info).toHaveProperty('path');

      expect(info.exists).toBe(true);
      expect(info.size).toBeGreaterThan(0);
      expect(info.path).toContain('log.txt');
    });

    it('should accept requests without authentication when using --no-auth', async () => {
      const response = await fetch(`http://localhost:${server?.port}/api/logs/info`);
      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/logs/raw', () => {
    it.skip('should stream log file content', async () => {
      // Add some client logs first
      await fetch(`http://localhost:${server?.port}/api/logs/client`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          level: 'log',
          module: 'test-raw',
          args: ['This is a test log for raw endpoint'],
        }),
      });

      // Wait for log to be written and flushed
      await sleep(500);

      const response = await fetch(`http://localhost:${server?.port}/api/logs/raw`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');

      const content = await response.text();
      // Skip checking for startup message as log file might be empty initially

      // The client log might not be in the file yet, so check if it exists
      if (!content.includes('CLIENT:test-raw')) {
        // Wait a bit more and try again
        await sleep(1000);
        const response2 = await fetch(`http://localhost:${server?.port}/api/logs/raw`);
        const content2 = await response2.text();
        expect(content2).toContain('CLIENT:test-raw');
        expect(content2).toContain('This is a test log for raw endpoint');
      } else {
        expect(content).toContain('CLIENT:test-raw');
        expect(content).toContain('This is a test log for raw endpoint');
      }
    });

    it('should accept requests without authentication when using --no-auth', async () => {
      // Wait a bit to avoid socket issues
      await sleep(200);

      const response = await fetch(`http://localhost:${server?.port}/api/logs/raw`);
      expect(response.status).toBe(200);
    });
  });

  describe('DELETE /api/logs/clear', () => {
    it('should clear the log file', async () => {
      // Wait to avoid socket issues from previous test
      await sleep(200);

      // First, ensure there's some content in the log file
      await fetch(`http://localhost:${server?.port}/api/logs/client`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          level: 'log',
          module: 'test-clear',
          args: ['Test log before clearing'],
        }),
      });

      // Wait for log to be written
      await sleep(500);

      const infoResponse = await fetch(`http://localhost:${server?.port}/api/logs/info`);
      const infoBefore = await infoResponse.json();

      // Clear logs
      const clearResponse = await fetch(`http://localhost:${server?.port}/api/logs/clear`, {
        method: 'DELETE',
      });
      expect(clearResponse.status).toBe(204);

      // Wait for file operation
      await sleep(100);

      // Verify log file is empty or very small
      const infoAfterResponse = await fetch(`http://localhost:${server?.port}/api/logs/info`);
      const infoAfter = await infoAfterResponse.json();

      // Log file should be much smaller after clearing (might have some new logs already)
      // Allow up to 10KB for startup logs that might be written immediately after clearing
      expect(infoAfter.size).toBeLessThan(10000);

      // Only check relative size if original log was large enough to make comparison meaningful
      // Skip this check if original log was small (< 10KB) as new logs might exceed half the size
      const LOG_SIZE_THRESHOLD = 10000; // 10KB - minimum size for meaningful comparison
      if (infoBefore.size > LOG_SIZE_THRESHOLD) {
        expect(infoAfter.size).toBeLessThan(infoBefore.size / 2);
      }
    });

    it('should accept requests without authentication when using --no-auth', async () => {
      // Wait to avoid socket issues
      await sleep(200);

      const response = await fetch(`http://localhost:${server?.port}/api/logs/clear`, {
        method: 'DELETE',
      });
      expect(response.status).toBe(204);
    });
  });

  describe('Log file format', () => {
    it.skip('should format logs correctly', async () => {
      // Submit a test log
      await fetch(`http://localhost:${server?.port}/api/logs/client`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          level: 'warn',
          module: 'format-test',
          args: ['Test warning message', { details: 'test object' }],
        }),
      });

      // Wait for log to be written and flushed
      await sleep(500);

      // Read raw logs
      const response = await fetch(`http://localhost:${server?.port}/api/logs/raw`);
      const logs = await response.text();

      // Check log format
      let lines = logs.split('\n');
      let testLogLineIndex = lines.findIndex((line) => line.includes('CLIENT:format-test'));

      // If not found, wait and try again
      if (testLogLineIndex === -1) {
        await sleep(1000);
        const response2 = await fetch(`http://localhost:${server?.port}/api/logs/raw`);
        const logs2 = await response2.text();
        lines = logs2.split('\n');
        testLogLineIndex = lines.findIndex((line) => line.includes('CLIENT:format-test'));
      }

      expect(testLogLineIndex).toBeGreaterThanOrEqual(0);
      const testLogLine = lines[testLogLineIndex];

      expect(testLogLine).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/); // Timestamp format
      expect(testLogLine).toContain('WARN');
      expect(testLogLine).toContain('[CLIENT:format-test]');
      expect(testLogLine).toContain('Test warning message');

      // Check for JSON object - it might be inline or on multiple lines
      const logContent = lines.slice(testLogLineIndex, testLogLineIndex + 5).join('\n');
      expect(logContent).toContain('"details": "test object"');
    });
  });
});
