/**
 * Integration tests for the socket protocol with PTY manager
 *
 * Note: Some tests in this file require real PTY support and will fail when node-pty
 * is mocked (which happens in src/test/setup.ts). To run these tests with real PTY:
 * 1. Comment out the node-pty mock in src/test/setup.ts
 * 2. Run the tests
 * 3. Restore the mock when done
 *
 * The affected tests are marked with comments.
 */

import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PtyManager } from '../../server/pty/pty-manager.js';
import { VibeTunnelSocketClient } from '../../server/pty/socket-client.js';
import { TitleMode } from '../../shared/types.js';
import { SessionTestHelper } from '../helpers/session-test-helper.js';

describe('Socket Protocol Integration', () => {
  let testDir: string;
  let ptyManager: PtyManager;
  let sessionHelper: SessionTestHelper;

  beforeEach(async () => {
    // IMPORTANT: macOS has a 104 character limit for Unix socket paths (103 usable).
    // The full socket path will be: testDir + sessionId (36 chars UUID) + '/ipc.sock' (9 chars)
    // Example: /tmp/vt-1234567890/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx/ipc.sock
    // So we need to keep testDir very short to stay under the limit.
    // Using /tmp/vt-timestamp keeps us well under the limit.
    testDir = `/tmp/vt-${Date.now()}`;
    fs.mkdirSync(testDir, { recursive: true });

    // Initialize PtyManager before creating instance
    await PtyManager.initialize();

    ptyManager = new PtyManager(testDir);
    sessionHelper = new SessionTestHelper(ptyManager);
  });

  afterEach(async () => {
    await sessionHelper.killTrackedSessions();
    // NEVER call ptyManager.shutdown() as it would kill ALL sessions
    // including the VibeTunnel session running Claude Code
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Session communication', () => {
    it('should handle stdin/stdout through socket', async () => {
      // Note: This test requires real PTY support. It will fail if node-pty is mocked.
      // Create a session that echoes input
      const { sessionId } = await sessionHelper.createTrackedSession(['sh', '-c', 'cat'], {
        name: 'echo-test',
        workingDir: process.cwd(),
      });

      // Connect socket client
      const socketPath = path.join(testDir, sessionId, 'ipc.sock');
      const client = new VibeTunnelSocketClient(socketPath);

      // Wait for socket file to exist
      let attempts = 0;
      while (!fs.existsSync(socketPath) && attempts < 50) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        attempts++;
      }

      if (!fs.existsSync(socketPath)) {
        throw new Error(`Socket file not created after ${attempts} attempts`);
      }

      await client.connect();

      // Send some input
      const testInput = 'echo "Hello, Socket!"\n';
      client.sendStdin(testInput);

      // Give it more time to process
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check that output was written to the asciinema file
      const streamPath = path.join(testDir, sessionId, 'stdout');
      expect(fs.existsSync(streamPath)).toBe(true);

      const content = fs.readFileSync(streamPath, 'utf8');
      const lines = content.trim().split('\n');

      // Should have header and at least one output event
      expect(lines.length).toBeGreaterThanOrEqual(2);

      // Parse output events
      let foundEcho = false;
      for (let i = 1; i < lines.length; i++) {
        try {
          const event = JSON.parse(lines[i]);
          if (event[1] === 'o' && event[2].includes('Hello, Socket!')) {
            foundEcho = true;
            break;
          }
        } catch {
          // Skip non-JSON lines
        }
      }

      expect(foundEcho).toBe(true);

      client.disconnect();
    });

    it('should handle resize commands through socket', async () => {
      const { sessionId } = await sessionHelper.createTrackedSession(['sh'], {
        name: 'resize-test',
        workingDir: process.cwd(),
        cols: 80,
        rows: 24,
      });

      // Connect socket client
      const socketPath = path.join(testDir, sessionId, 'ipc.sock');
      const client = new VibeTunnelSocketClient(socketPath);

      // Wait for socket file to exist
      let attempts = 0;
      while (!fs.existsSync(socketPath) && attempts < 50) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        attempts++;
      }

      await client.connect();

      // Send resize command
      client.resize(120, 40);

      // Give it time to process
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check that resize was recorded
      const streamPath = path.join(testDir, sessionId, 'stdout');
      const content = fs.readFileSync(streamPath, 'utf8');
      const lines = content.trim().split('\n');

      let foundResize = false;
      for (let i = 1; i < lines.length; i++) {
        try {
          const event = JSON.parse(lines[i]);
          if (event[1] === 'r' && event[2] === '120x40') {
            foundResize = true;
            break;
          }
        } catch {
          // Skip non-JSON lines
        }
      }

      expect(foundResize).toBe(true);

      client.disconnect();
    });

    it('should handle kill command through socket', async () => {
      // Note: This test requires real PTY support. It will fail if node-pty is mocked.
      const { sessionId } = await sessionHelper.createTrackedSession(['sleep', '60'], {
        name: 'kill-test',
        workingDir: process.cwd(),
      });

      // Connect socket client
      const socketPath = path.join(testDir, sessionId, 'ipc.sock');
      const client = new VibeTunnelSocketClient(socketPath);

      // Wait for socket file to exist
      let attempts = 0;
      while (!fs.existsSync(socketPath) && attempts < 50) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        attempts++;
      }

      await client.connect();

      // Send kill command
      client.kill('SIGTERM');

      // Wait for process to exit
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check that session is marked as exited
      const session = ptyManager.getSession(sessionId);
      expect(session?.status).toBe('exited');

      client.disconnect();
    });
  });

  describe('Claude status tracking', () => {
    it('should track Claude status updates', async () => {
      // Create a session with dynamic title mode
      const { sessionId } = await sessionHelper.createTrackedSession(['echo', 'test'], {
        name: 'claude-test',
        workingDir: process.cwd(),
        titleMode: TitleMode.DYNAMIC,
      });

      // Connect socket client
      const socketPath = path.join(testDir, sessionId, 'ipc.sock');
      const client = new VibeTunnelSocketClient(socketPath);

      // Wait for socket file to exist
      let attempts = 0;
      while (!fs.existsSync(socketPath) && attempts < 50) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        attempts++;
      }

      await client.connect();

      // Send Claude status update
      client.sendStatus('claude', '✻ Thinking (5s, ↑2.5k tokens)');

      // Give it time to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Check that status is tracked in session list
      const sessions = ptyManager.listSessions();
      const session = sessions.find((s) => s.id === sessionId);

      expect(session?.activityStatus?.specificStatus).toEqual({
        app: 'claude',
        status: '✻ Thinking (5s, ↑2.5k tokens)',
      });

      client.disconnect();
    });

    it('should broadcast status to other clients', async () => {
      const { sessionId } = await sessionHelper.createTrackedSession(['sleep', '60'], {
        name: 'broadcast-test',
        workingDir: process.cwd(),
      });

      const socketPath = path.join(testDir, sessionId, 'ipc.sock');

      // Wait for socket file to exist
      let attempts = 0;
      while (!fs.existsSync(socketPath) && attempts < 50) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        attempts++;
      }

      // Connect two clients
      const client1 = new VibeTunnelSocketClient(socketPath);
      const client2 = new VibeTunnelSocketClient(socketPath);

      await client1.connect();
      await client2.connect();

      // Set up status listener on client2
      let receivedStatus: { app: string; status: string } | null = null;
      client2.on('STATUS_UPDATE', (status) => {
        receivedStatus = status;
      });

      // Send status from client1
      client1.sendStatus('claude', '✻ Processing');

      // Wait for broadcast
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Client2 should have received the status
      expect(receivedStatus).toEqual({
        app: 'claude',
        status: '✻ Processing',
      });

      client1.disconnect();
      client2.disconnect();
    });
  });

  describe('Error handling', () => {
    it('should handle client sending to non-existent session', async () => {
      const fakeSessionId = 'non-existent-session';
      const socketPath = path.join(testDir, fakeSessionId, 'ipc.sock');

      const client = new VibeTunnelSocketClient(socketPath);

      // Should fail to connect
      await expect(client.connect()).rejects.toThrow();
    });

    it('should handle malformed messages gracefully', async () => {
      const { sessionId } = await sessionHelper.createTrackedSession(['sleep', '60'], {
        name: 'malformed-test',
        workingDir: process.cwd(),
      });

      const socketPath = path.join(testDir, sessionId, 'ipc.sock');
      const client = new VibeTunnelSocketClient(socketPath);

      // Wait for socket file to exist
      let attempts = 0;
      while (!fs.existsSync(socketPath) && attempts < 50) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        attempts++;
      }

      await client.connect();

      // Send some random bytes that don't form a valid message
      const socket = (client as unknown as { socket: { write: (data: Buffer) => void } }).socket;
      socket.write(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]));

      // Should not crash
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should still be able to send valid messages
      expect(client.sendStdin('test')).toBe(true);

      client.disconnect();
    });
  });

  describe('Performance', () => {
    it('should handle high-throughput stdin data', async () => {
      const { sessionId } = await sessionHelper.createTrackedSession(['cat'], {
        name: 'throughput-test',
        workingDir: process.cwd(),
      });

      const socketPath = path.join(testDir, sessionId, 'ipc.sock');
      const client = new VibeTunnelSocketClient(socketPath);

      // Wait for socket file to exist
      let attempts = 0;
      while (!fs.existsSync(socketPath) && attempts < 50) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        attempts++;
      }

      await client.connect();

      // Send lots of data rapidly
      const chunk = 'x'.repeat(1000);
      const startTime = Date.now();

      for (let i = 0; i < 100; i++) {
        client.sendStdin(chunk);
      }

      const duration = Date.now() - startTime;

      // Should handle 100KB in under 1 second
      expect(duration).toBeLessThan(1000);

      client.disconnect();
    });

    it('should handle rapid status updates', async () => {
      const { sessionId } = await sessionHelper.createTrackedSession(['sleep', '60'], {
        name: 'status-perf-test',
        workingDir: process.cwd(),
      });

      const socketPath = path.join(testDir, sessionId, 'ipc.sock');
      const client = new VibeTunnelSocketClient(socketPath);

      // Wait for socket file to exist
      let attempts = 0;
      while (!fs.existsSync(socketPath) && attempts < 50) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        attempts++;
      }

      await client.connect();

      // Send many status updates
      const startTime = Date.now();

      for (let i = 0; i < 1000; i++) {
        client.sendStatus('claude', `Status update ${i}`);
      }

      const duration = Date.now() - startTime;

      // Should handle 1000 status updates quickly
      expect(duration).toBeLessThan(500);

      // Give a bit of time for the last status to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Check that the last status is stored
      const sessions = ptyManager.listSessions();
      const session = sessions.find((s) => s.id === sessionId);

      expect(session?.activityStatus?.specificStatus?.status).toMatch(/Status update \d+/);

      client.disconnect();
    });
  });

  describe('Multiple sessions', () => {
    it('should handle multiple sessions with separate sockets', async () => {
      // Create two sessions
      const { sessionId: sessionId1 } = await sessionHelper.createTrackedSession(['sleep', '60'], {
        name: 'session-1',
      });

      const { sessionId: sessionId2 } = await sessionHelper.createTrackedSession(['sleep', '60'], {
        name: 'session-2',
      });

      // Wait for both socket files to exist
      const socketPath1 = path.join(testDir, sessionId1, 'ipc.sock');
      const socketPath2 = path.join(testDir, sessionId2, 'ipc.sock');

      let attempts = 0;
      while ((!fs.existsSync(socketPath1) || !fs.existsSync(socketPath2)) && attempts < 50) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        attempts++;
      }

      // Connect to both
      const client1 = new VibeTunnelSocketClient(socketPath1);
      const client2 = new VibeTunnelSocketClient(socketPath2);

      await client1.connect();
      await client2.connect();

      // Send different status to each
      client1.sendStatus('claude', 'Session 1 status');
      client2.sendStatus('claude', 'Session 2 status');

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check that each session has its own status
      const sessions = ptyManager.listSessions();
      const session1 = sessions.find((s) => s.id === sessionId1);
      const session2 = sessions.find((s) => s.id === sessionId2);

      expect(session1?.activityStatus?.specificStatus?.status).toBe('Session 1 status');
      expect(session2?.activityStatus?.specificStatus?.status).toBe('Session 2 status');

      client1.disconnect();
      client2.disconnect();
    });
  });
});
