import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { SessionData } from '../types/test-types';
import {
  cleanupTestDirectories,
  createTestDirectory,
  type ServerInstance,
  sleep,
  startTestServer,
  stopServer,
  waitForServerHealth,
} from '../utils/server-utils';

describe.skip('Resource Limits and Concurrent Sessions', () => {
  let server: ServerInstance | null = null;
  let testDir: string;

  beforeAll(async () => {
    // Create temporary directory for test (use short name to avoid Unix socket path limits)
    testDir = createTestDirectory('rs');

    // Start server with specific limits
    server = await startTestServer({
      args: ['--port', '0', '--no-auth'],
      controlDir: testDir,
      env: {
        // Set reasonable limits for testing
        VIBETUNNEL_MAX_SESSIONS: '20',
        VIBETUNNEL_MAX_WEBSOCKETS: '50',
      },
      serverType: 'RESOURCE_TEST',
    });

    await waitForServerHealth(server.port);
  });

  afterAll(async () => {
    // Kill server process
    if (server) {
      await stopServer(server.process);
    }

    // Clean up test directory
    await cleanupTestDirectories([testDir]);
  });

  describe('Concurrent Session Creation', () => {
    it('should handle multiple concurrent sessions', async () => {
      const sessionIds: string[] = [];
      const sessionCount = 10;

      // Create multiple sessions concurrently
      const createPromises = Array.from({ length: sessionCount }, (_, i) =>
        fetch(`http://localhost:${server?.port}/api/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            command: ['bash', '-c', `echo "Session ${i}"; sleep 5`],
            workingDir: testDir,
            name: `Concurrent Test ${i}`,
          }),
        })
      );

      const responses = await Promise.all(createPromises);

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result).toHaveProperty('sessionId');
        sessionIds.push(result.sessionId);
      }

      // Verify all sessions are listed
      const listResponse = await fetch(`http://localhost:${server?.port}/api/sessions`);
      const sessions = await listResponse.json();
      expect(sessions.length).toBeGreaterThanOrEqual(sessionCount);

      // Clean up sessions
      await Promise.all(
        sessionIds.map((id) =>
          fetch(`http://localhost:${server?.port}/api/sessions/${id}`, {
            method: 'DELETE',
          })
        )
      );
    });

    // Skipped: This test takes ~11.7 seconds due to sequential operations with 50ms delays
    // Re-enable when performance optimizations are implemented or for comprehensive testing
    it.skip('should handle rapid session creation and deletion', async () => {
      const operations = 20;
      let successCount = 0;

      for (let i = 0; i < operations; i++) {
        // Create session
        const createResponse = await fetch(`http://localhost:${server?.port}/api/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            command: ['echo', `Rapid test ${i}`],
            workingDir: testDir,
            name: `Rapid Test ${i}`,
          }),
        });

        if (createResponse.status === 200) {
          const { sessionId } = await createResponse.json();
          successCount++;

          // Immediately delete
          await fetch(`http://localhost:${server?.port}/api/sessions/${sessionId}`, {
            method: 'DELETE',
          });
        }

        // Small delay to avoid overwhelming the server
        await sleep(50);
      }

      // Most operations should succeed
      expect(successCount).toBeGreaterThan(operations * 0.8);
    });
  });

  describe('WebSocket Connection Limits', () => {
    it('should handle multiple WebSocket connections', async () => {
      const websockets: WebSocket[] = [];
      const connectionCount = 15;

      try {
        // Create multiple WebSocket connections
        for (let i = 0; i < connectionCount; i++) {
          const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

          await new Promise<void>((resolve, reject) => {
            ws.on('open', () => resolve());
            ws.on('error', (err) => reject(err));
          });

          websockets.push(ws);
        }

        expect(websockets.length).toBe(connectionCount);

        // All connections should be open
        for (const ws of websockets) {
          expect(ws.readyState).toBe(WebSocket.OPEN);
        }
      } finally {
        // Clean up
        for (const ws of websockets) {
          ws.close();
        }
      }
    });

    it.skip('should handle WebSocket subscription stress', async () => {
      // Create several sessions
      const sessionCount = 5;
      const sessionIds: string[] = [];

      for (let i = 0; i < sessionCount; i++) {
        const response = await fetch(`http://localhost:${server?.port}/api/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            command: ['bash', '-c', `while true; do echo "Session ${i}: $(date)"; sleep 1; done`],
            workingDir: testDir,
            name: `WebSocket Stress ${i}`,
          }),
        });

        const { sessionId } = await response.json();
        sessionIds.push(sessionId);
      }

      // Create WebSocket and subscribe to all sessions
      const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

      try {
        await new Promise<void>((resolve) => {
          ws.on('open', () => resolve());
        });

        // Subscribe to all sessions
        for (const sessionId of sessionIds) {
          ws.send(JSON.stringify({ type: 'subscribe', sessionId }));
        }

        // Wait and count received updates
        let updateCount = 0;
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => resolve(), 3000);

          ws.on('message', (data: Buffer) => {
            if (data[0] === 0xbf) {
              // Binary buffer update
              updateCount++;
              if (updateCount >= sessionCount * 2) {
                clearTimeout(timeout);
                resolve();
              }
            }
          });
        });

        // Should receive multiple updates from each session
        expect(updateCount).toBeGreaterThanOrEqual(sessionCount);
      } finally {
        ws.close();

        // Clean up sessions
        await Promise.all(
          sessionIds.map((id) =>
            fetch(`http://localhost:${server?.port}/api/sessions/${id}`, {
              method: 'DELETE',
            })
          )
        );
      }
    });
  });

  describe('Memory Usage', () => {
    it.skip('should handle large output gracefully', async () => {
      // Create session that generates large output
      const createResponse = await fetch(`http://localhost:${server?.port}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: [
            'bash',
            '-c',
            'for i in {1..1000}; do echo "Line $i: $(seq -s " " 1 100)"; done',
          ],
          workingDir: testDir,
          name: 'Large Output Test',
        }),
      });

      expect(createResponse.status).toBe(200);
      const { sessionId } = await createResponse.json();

      // Wait for command to complete
      await sleep(5000);

      // Fetch session info
      const infoResponse = await fetch(
        `http://localhost:${server?.port}/api/sessions/${sessionId}`
      );

      expect(infoResponse.status).toBe(200);
      const sessionInfo: SessionData = await infoResponse.json();
      expect(sessionInfo.status).toBe('exited');

      // Clean up
      await fetch(`http://localhost:${server?.port}/api/sessions/${sessionId}`, {
        method: 'DELETE',
      });
    });

    it.skip('should handle sessions with continuous output', async () => {
      const sessionIds: string[] = [];
      const sessionCount = 3;

      // Create sessions with continuous output
      for (let i = 0; i < sessionCount; i++) {
        const response = await fetch(`http://localhost:${server?.port}/api/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            command: [
              'bash',
              '-c',
              `while true; do echo "Continuous output ${i}: $(date)"; sleep 0.1; done`,
            ],
            workingDir: testDir,
            name: `Continuous Output ${i}`,
          }),
        });

        const { sessionId } = await response.json();
        sessionIds.push(sessionId);
      }

      // Let them run for a bit
      await sleep(3000);

      // All sessions should still be active
      const listResponse = await fetch(`http://localhost:${server?.port}/api/sessions`);
      const sessions = await listResponse.json();

      const activeSessions = sessions.filter(
        (s: SessionData) => sessionIds.includes(s.id) && s.status === 'running'
      );
      expect(activeSessions.length).toBe(sessionCount);

      // Clean up
      await Promise.all(
        sessionIds.map((id) =>
          fetch(`http://localhost:${server?.port}/api/sessions/${id}`, {
            method: 'DELETE',
          })
        )
      );
    });
  });

  describe('Error Recovery', () => {
    it.skip('should recover from session crashes', async () => {
      // Create a session that will crash
      const createResponse = await fetch(`http://localhost:${server?.port}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['bash', '-c', 'echo "Starting"; sleep 1; exit 1'],
          workingDir: testDir,
          name: 'Crash Test',
        }),
      });

      expect(createResponse.status).toBe(200);
      const { sessionId } = await createResponse.json();

      // Wait for crash
      await sleep(3000);

      // Check session state
      const infoResponse = await fetch(
        `http://localhost:${server?.port}/api/sessions/${sessionId}`
      );

      const sessionInfo: SessionData = await infoResponse.json();
      expect(sessionInfo.status).toBe('exited');
      expect(sessionInfo.exitCode).toBe(1);

      // Server should still be responsive
      const healthResponse = await fetch(`http://localhost:${server?.port}/api/health`);
      expect(healthResponse.status).toBe(200);
    });

    it('should handle invalid session operations gracefully', async () => {
      const fakeSessionId = 'non-existent-session';

      // Try to get info for non-existent session
      const infoResponse = await fetch(
        `http://localhost:${server?.port}/api/sessions/${fakeSessionId}`
      );
      expect(infoResponse.status).toBe(404);

      // Try to send input to non-existent session
      const inputResponse = await fetch(
        `http://localhost:${server?.port}/api/sessions/${fakeSessionId}/input`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: 'test' }),
        }
      );
      expect(inputResponse.status).toBe(404);

      // Try to delete non-existent session
      const deleteResponse = await fetch(
        `http://localhost:${server?.port}/api/sessions/${fakeSessionId}`,
        {
          method: 'DELETE',
        }
      );
      expect(deleteResponse.status).toBe(404);
    });
  });
});
