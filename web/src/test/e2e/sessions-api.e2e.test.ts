import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionData } from '../types/test-types';
import { type ServerInstance, startTestServer, stopServer } from '../utils/server-utils';
import { testLogger } from '../utils/test-logger';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Sessions API Tests', () => {
  let server: ServerInstance | null = null;

  beforeAll(async () => {
    // Start server with no authentication
    server = await startTestServer({
      args: ['--port', '0', '--no-auth'],
      env: {},
      waitForHealth: true,
    });
  });

  afterAll(async () => {
    if (server) {
      await stopServer(server.process);
    }
  });

  describe('GET /api/sessions', () => {
    it('should return empty array when no sessions exist', async () => {
      const response = await fetch(`http://localhost:${server?.port}/api/sessions`);

      expect(response.status).toBe(200);
      const sessions = await response.json();
      expect(sessions).toEqual([]);
    });

    it('should accept requests without authentication when using --no-auth', async () => {
      const response = await fetch(`http://localhost:${server?.port}/api/sessions`);
      expect(response.status).toBe(200);
    });
  });

  describe('POST /api/sessions', () => {
    it('should create a new session', async () => {
      const response = await fetch(`http://localhost:${server?.port}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['echo', 'hello world'],
          workingDir: server?.testDir,
        }),
      });

      if (response.status !== 200) {
        await testLogger.logHttpError('Session creation', response);
      }
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result).toHaveProperty('sessionId');
      expect(result.sessionId).toMatch(/^[a-f0-9-]{36}$/); // UUID format
    });

    it('should create session with name', async () => {
      const sessionName = 'Test Session';
      const response = await fetch(`http://localhost:${server?.port}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['echo', 'named session'],
          workingDir: server?.testDir,
          name: sessionName,
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();

      // Verify session was created with the name
      const listResponse = await fetch(`http://localhost:${server?.port}/api/sessions`);
      const sessions = await listResponse.json();
      const createdSession = sessions.find((s: SessionData) => s.id === result.sessionId);
      expect(createdSession?.name).toBe(sessionName);
    });

    it('should create session with fallback for invalid working directory', async () => {
      const response = await fetch(`http://localhost:${server?.port}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['echo', 'test'],
          workingDir: '/nonexistent/directory',
        }),
      });

      // Server creates session even with invalid directory (it will use cwd as fallback)
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result).toHaveProperty('sessionId');
    });

    it('should create session with initial dimensions', async () => {
      const response = await fetch(`http://localhost:${server?.port}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['echo', 'dimension test'],
          workingDir: server?.testDir,
          cols: 120,
          rows: 30,
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result).toHaveProperty('sessionId');

      // Verify session was created with initial dimensions
      const sessionResponse = await fetch(
        `http://localhost:${server?.port}/api/sessions/${result.sessionId}`
      );
      const session = await sessionResponse.json();
      expect(session.initialCols).toBe(120);
      expect(session.initialRows).toBe(30);
    });
  });

  describe('Session lifecycle', () => {
    let sessionId: string;

    beforeAll(async () => {
      // Create a long-running session
      const response = await fetch(`http://localhost:${server?.port}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['bash', '-c', 'while true; do echo "running"; sleep 1; done'],
          workingDir: server?.testDir,
          name: 'Long Running Test',
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result).toHaveProperty('sessionId');
      sessionId = result.sessionId;

      // Wait for session to start
      await sleep(500);
    });

    it('should list the created session', async () => {
      const response = await fetch(`http://localhost:${server?.port}/api/sessions`);

      expect(response.status).toBe(200);
      const sessions = await response.json();

      const session = sessions.find((s: SessionData) => s.id === sessionId);
      expect(session).toBeDefined();
      expect(session.name).toBe('Long Running Test');
      expect(session.status).toBe('running');
      expect(session.command).toEqual([
        'bash',
        '-c',
        'while true; do echo "running"; sleep 1; done',
      ]);
    });

    it('should send input to session', async () => {
      const response = await fetch(
        `http://localhost:${server?.port}/api/sessions/${sessionId}/input`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: 'echo "test input"\n' }),
        }
      );

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
    });

    it('should resize session', async () => {
      const response = await fetch(
        `http://localhost:${server?.port}/api/sessions/${sessionId}/resize`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ cols: 120, rows: 40 }),
        }
      );

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.cols).toBe(120);
      expect(result.rows).toBe(40);
    });

    it.skip('should get session text', async () => {
      // Wait a bit for output to accumulate
      await sleep(1500);

      const response = await fetch(
        `http://localhost:${server?.port}/api/sessions/${sessionId}/text`
      );

      expect(response.status).toBe(200);
      const text = await response.text();
      // The text might be empty initially or contain the echo output
      expect(text).toBeDefined();
      expect(typeof text).toBe('string');
    });

    it('should get session text with styles', async () => {
      const response = await fetch(
        `http://localhost:${server?.port}/api/sessions/${sessionId}/text?styles=true`
      );

      expect(response.status).toBe(200);
      const text = await response.text();
      // Should contain style markup if terminal has any styled output
      expect(text).toBeDefined();
    });

    it('should get session buffer', async () => {
      // Wait a bit after resize to ensure it's processed
      await sleep(200);

      const response = await fetch(
        `http://localhost:${server?.port}/api/sessions/${sessionId}/buffer`
      );

      expect(response.status).toBe(200);
      const buffer = await response.arrayBuffer();

      // Check binary format header
      const view = new DataView(buffer);
      // Magic bytes "VT" - server writes in little-endian
      expect(view.getUint16(0, true)).toBe(0x5654); // "VT" in little-endian
      expect(view.getUint8(2)).toBe(1); // Version

      // Check dimensions - cols should match terminal size, rows is actual content
      expect(view.getUint32(4, true)).toBe(120); // Cols (LE) - terminal width
      const actualRows = view.getUint32(8, true);
      expect(actualRows).toBeGreaterThan(0); // Rows (LE) - actual content rows
      expect(actualRows).toBeLessThanOrEqual(40); // Should not exceed terminal height

      // Buffer size check - verify it's reasonable
      // The size depends heavily on content - empty terminals are very small due to optimization
      // For a mostly empty terminal, we might see as little as 80-200 bytes
      // For a terminal with content, it can be 20KB+
      expect(buffer.byteLength).toBeGreaterThan(50); // At least minimal header + some data
      expect(buffer.byteLength).toBeLessThan(100000); // Less than 100KB for sanity

      // The buffer uses run-length encoding for empty space, so size varies greatly
      // based on how much actual content vs empty space there is
    });

    it('should get session activity', async () => {
      const response = await fetch(
        `http://localhost:${server?.port}/api/sessions/${sessionId}/activity`
      );

      expect(response.status).toBe(200);
      const activity = await response.json();

      expect(activity).toHaveProperty('isActive');
      expect(activity).toHaveProperty('timestamp');
      expect(activity).toHaveProperty('session');
      expect(activity.session.command).toEqual([
        'bash',
        '-c',
        'while true; do echo "running"; sleep 1; done',
      ]);
    });

    it('should get all sessions activity', async () => {
      const response = await fetch(`http://localhost:${server?.port}/api/sessions/activity`);

      expect(response.status).toBe(200);
      const activities = await response.json();

      expect(activities).toHaveProperty(sessionId);
      expect(activities[sessionId]).toHaveProperty('isActive');
      expect(activities[sessionId]).toHaveProperty('timestamp');
    });

    it('should handle SSE stream', async () => {
      const response = await fetch(
        `http://localhost:${server?.port}/api/sessions/${sessionId}/stream`,
        {
          headers: {
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

    it.skip('should kill session', async () => {
      const response = await fetch(`http://localhost:${server?.port}/api/sessions/${sessionId}`, {
        method: 'DELETE',
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);

      // Wait for session to be killed
      await sleep(1000);

      // Verify session is terminated (it may still be in the list but with 'exited' status)
      const listResponse = await fetch(`http://localhost:${server?.port}/api/sessions`);
      const sessions = await listResponse.json();
      const killedSession = sessions.find((s: SessionData) => s.id === sessionId);

      // Session might still exist but should be terminated
      if (killedSession) {
        expect(killedSession.status).toBe('exited');
      }
      // Or it might be cleaned up already
      // Both are valid outcomes
    });
  });

  describe('Error handling', () => {
    it('should return 404 for non-existent session', async () => {
      const response = await fetch(
        `http://localhost:${server?.port}/api/sessions/nonexistent/input`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: 'test' }),
        }
      );

      expect(response.status).toBe(404);
    });

    it('should handle invalid input data', async () => {
      // Create a session first
      const createResponse = await fetch(`http://localhost:${server?.port}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['cat'],
          workingDir: server?.testDir,
        }),
      });

      expect(createResponse.status).toBe(200);
      const result = await createResponse.json();
      expect(result).toHaveProperty('sessionId');
      const sessionId = result.sessionId;

      // Send invalid input (missing data field)
      const response = await fetch(
        `http://localhost:${server?.port}/api/sessions/${sessionId}/input`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      );

      expect(response.status).toBe(400);
    });

    it('should handle invalid resize dimensions', async () => {
      // Create a session first
      const createResponse = await fetch(`http://localhost:${server?.port}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['cat'],
          workingDir: server?.testDir,
        }),
      });

      expect(createResponse.status).toBe(200);
      const result = await createResponse.json();
      expect(result).toHaveProperty('sessionId');
      const sessionId = result.sessionId;

      // Send invalid resize (negative dimensions)
      const response = await fetch(
        `http://localhost:${server?.port}/api/sessions/${sessionId}/resize`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ cols: -1, rows: 40 }),
        }
      );

      expect(response.status).toBe(400);
    });
  });
});
