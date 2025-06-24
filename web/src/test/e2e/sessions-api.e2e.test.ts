import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionData } from '../types/test-types';
import { type ServerInstance, startTestServer, stopServer } from '../utils/server-utils';
import { testLogger } from '../utils/test-logger';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Sessions API Tests', () => {
  let server: ServerInstance | null = null;
  const username = 'testuser';
  const password = 'testpass';
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  beforeAll(async () => {
    // Start server with authentication
    server = await startTestServer({
      args: ['--port', '0'],
      env: {
        VIBETUNNEL_USERNAME: username,
        VIBETUNNEL_PASSWORD: password,
      },
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
      const response = await fetch(`http://localhost:${server?.port}/api/sessions`, {
        headers: { Authorization: authHeader },
      });

      expect(response.status).toBe(200);
      const sessions = await response.json();
      expect(sessions).toEqual([]);
    });

    it('should require authentication', async () => {
      const response = await fetch(`http://localhost:${server?.port}/api/sessions`);
      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/sessions', () => {
    it('should create a new session', async () => {
      const response = await fetch(`http://localhost:${server?.port}/api/sessions`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
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
          Authorization: authHeader,
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
      const listResponse = await fetch(`http://localhost:${server?.port}/api/sessions`, {
        headers: { Authorization: authHeader },
      });
      const sessions = await listResponse.json();
      const createdSession = sessions.find((s: SessionData) => s.id === result.sessionId);
      expect(createdSession?.name).toBe(sessionName);
    });

    it('should create session with fallback for invalid working directory', async () => {
      const response = await fetch(`http://localhost:${server?.port}/api/sessions`, {
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

      // Server creates session even with invalid directory (it will use cwd as fallback)
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result).toHaveProperty('sessionId');
    });
  });

  describe('Session lifecycle', () => {
    let sessionId: string;

    beforeAll(async () => {
      // Create a long-running session
      const response = await fetch(`http://localhost:${server?.port}/api/sessions`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
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
      const response = await fetch(`http://localhost:${server?.port}/api/sessions`, {
        headers: { Authorization: authHeader },
      });

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
            Authorization: authHeader,
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
            Authorization: authHeader,
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
        `http://localhost:${server?.port}/api/sessions/${sessionId}/text`,
        {
          headers: { Authorization: authHeader },
        }
      );

      expect(response.status).toBe(200);
      const text = await response.text();
      // The text might be empty initially or contain the echo output
      expect(text).toBeDefined();
      expect(typeof text).toBe('string');
    });

    it('should get session text with styles', async () => {
      const response = await fetch(
        `http://localhost:${server?.port}/api/sessions/${sessionId}/text?styles=true`,
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
      // Wait a bit after resize to ensure it's processed
      await sleep(200);

      const response = await fetch(
        `http://localhost:${server?.port}/api/sessions/${sessionId}/buffer`,
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

      // Check dimensions match the resize (120x40)
      expect(view.getUint32(4)).toBe(120); // Cols
      expect(view.getUint32(8)).toBe(40); // Rows

      // Buffer size check - just verify it's a reasonable size
      expect(buffer.byteLength).toBeGreaterThan(32); // At least header + some data
      expect(buffer.byteLength).toBeLessThan(1000000); // Less than 1MB
    });

    it('should get session activity', async () => {
      const response = await fetch(
        `http://localhost:${server?.port}/api/sessions/${sessionId}/activity`,
        {
          headers: { Authorization: authHeader },
        }
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
      const response = await fetch(`http://localhost:${server?.port}/api/sessions/activity`, {
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
        `http://localhost:${server?.port}/api/sessions/${sessionId}/stream`,
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

    it.skip('should kill session', async () => {
      const response = await fetch(`http://localhost:${server?.port}/api/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: authHeader },
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);

      // Wait for session to be killed
      await sleep(1000);

      // Verify session is terminated (it may still be in the list but with 'exited' status)
      const listResponse = await fetch(`http://localhost:${server?.port}/api/sessions`, {
        headers: { Authorization: authHeader },
      });
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
      const createResponse = await fetch(`http://localhost:${server?.port}/api/sessions`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
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
      const createResponse = await fetch(`http://localhost:${server?.port}/api/sessions`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
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
