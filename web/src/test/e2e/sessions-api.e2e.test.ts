import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WsV3MessageType } from '../../shared/ws-v3.js';
import type { SessionData } from '../types/test-types';
import { type ServerInstance, startTestServer, stopServer } from '../utils/server-utils';
import { testLogger } from '../utils/test-logger';
import {
  connectWsV3,
  sendSubscribe,
  WS_V3_FLAGS,
  waitForWsV3Frame,
} from '../utils/ws-v3-test-utils';

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
      await sleep(1500);
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

    it('should get session text', async () => {
      // Wait a bit for output to accumulate
      await sleep(3000);

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

    it('should receive a VT snapshot via WebSocket v3', async () => {
      // Wait a bit after resize to ensure it's processed
      await sleep(200);

      const port = server?.port;
      if (!port) throw new Error('Server not started');
      const { ws } = await connectWsV3({ port });

      sendSubscribe({
        ws,
        sessionId,
        flags: WS_V3_FLAGS.Snapshots,
      });

      const snapshotFrame = await waitForWsV3Frame(
        ws,
        (frame) => frame.type === WsV3MessageType.SNAPSHOT_VT && frame.sessionId === sessionId,
        10000
      );

      expect(snapshotFrame.payload.byteLength).toBeGreaterThan(50);
      expect(snapshotFrame.payload.byteLength).toBeLessThan(100000);

      const view = new DataView(snapshotFrame.payload.buffer, snapshotFrame.payload.byteOffset);
      expect(view.getUint16(0, true)).toBe(0x5654); // "VT"
      expect(view.getUint8(2)).toBe(1); // snapshot v1
      expect(view.getUint32(4, true)).toBe(120); // cols (LE)

      ws.close();
    });

    it('should stream output via WebSocket v3', async () => {
      const port = server?.port;
      if (!port) throw new Error('Server not started');
      const { ws } = await connectWsV3({ port });

      sendSubscribe({
        ws,
        sessionId,
        flags: WS_V3_FLAGS.Stdout,
      });

      const stdoutFrame = await waitForWsV3Frame(
        ws,
        (frame) => frame.type === WsV3MessageType.STDOUT && frame.sessionId === sessionId,
        8000
      );
      expect(stdoutFrame.payload.byteLength).toBeGreaterThan(0);

      ws.close();
    });

    it('should kill session', async () => {
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
