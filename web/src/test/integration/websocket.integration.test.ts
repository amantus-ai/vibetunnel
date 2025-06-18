import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { app, server, wss } from '../../server';
import type { AddressInfo } from 'net';

// Set up test environment
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
const testControlDir = path.join(os.tmpdir(), 'vibetunnel-ws-test', uuidv4());
process.env.TTY_FWD_CONTROL_DIR = testControlDir;

beforeAll(() => {
  if (!fs.existsSync(testControlDir)) {
    fs.mkdirSync(testControlDir, { recursive: true });
  }
});

afterAll(() => {
  if (fs.existsSync(testControlDir)) {
    fs.rmSync(testControlDir, { recursive: true, force: true });
  }
});

describe('WebSocket Integration Tests', () => {
  let port: number;
  let wsUrl: string;
  let activeSessionIds: string[] = [];

  beforeAll(async () => {
    // Get server port
    await new Promise<void>((resolve) => {
      if (!server.listening) {
        server.listen(0, () => {
          const address = server.address();
          port = (address as AddressInfo).port;
          wsUrl = `ws://localhost:${port}`;
          resolve();
        });
      } else {
        const address = server.address();
        port = (address as AddressInfo).port;
        wsUrl = `ws://localhost:${port}`;
        resolve();
      }
    });
  });

  afterAll(async () => {
    // Clean up sessions
    for (const sessionId of activeSessionIds) {
      try {
        await request(app).delete(`/api/sessions/${sessionId}`);
      } catch (_e) {
        // Ignore
      }
    }

    // Close all WebSocket connections
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
    });

    // Close server
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  afterEach(() => {
    // Clean up sessions after each test
    activeSessionIds = [];
  });

  describe('Hot Reload WebSocket', () => {
    it('should accept hot reload connections', async () => {
      const ws = new WebSocket(`${wsUrl}?hotReload=true`);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          expect(ws.readyState).toBe(WebSocket.OPEN);
          ws.close();
          resolve();
        });

        ws.on('error', reject);
      });
    });

    it('should reject non-hot-reload connections', async () => {
      const ws = new WebSocket(wsUrl);

      await new Promise<void>((resolve) => {
        ws.on('close', (code, reason) => {
          expect(code).toBe(1008);
          expect(reason.toString()).toContain('Only hot reload connections supported');
          resolve();
        });

        ws.on('error', () => {
          // Expected
        });
      });
    });

    it('should handle multiple hot reload clients', async () => {
      const clients: WebSocket[] = [];
      const connectionPromises = [];

      // Connect multiple clients
      for (let i = 0; i < 3; i++) {
        const ws = new WebSocket(`${wsUrl}?hotReload=true`);
        clients.push(ws);

        const promise = new Promise<void>((resolve, reject) => {
          ws.on('open', () => resolve());
          ws.on('error', reject);
        });
        connectionPromises.push(promise);
      }

      await Promise.all(connectionPromises);

      // All clients should be connected
      expect(clients.every((ws) => ws.readyState === WebSocket.OPEN)).toBe(true);

      // Clean up
      clients.forEach((ws) => ws.close());
    });
  });

  describe('Terminal Session WebSocket (Future)', () => {
    // Note: The current server implementation only supports hot reload WebSockets
    // These tests document the expected behavior for terminal session WebSockets
    // when that functionality is implemented

    it.skip('should subscribe to terminal session output', async () => {
      // Create a session first
      const createResponse = await request(app)
        .post('/api/sessions')
        .send({
          command: ['sh', '-c', 'for i in 1 2 3; do echo "Line $i"; sleep 0.1; done'],
          workingDir: os.tmpdir(),
          name: 'WebSocket Test',
        })
        .expect(200);

      const sessionId = createResponse.body.sessionId;
      activeSessionIds.push(sessionId);

      // Connect WebSocket and subscribe
      const ws = new WebSocket(wsUrl);
      const messages: unknown[] = [];

      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()));
      });

      await new Promise<void>((resolve) => {
        ws.on('open', () => {
          // Subscribe to session
          ws.send(
            JSON.stringify({
              type: 'subscribe',
              sessionId: sessionId,
            })
          );
          resolve();
        });
      });

      // Wait for messages
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Should have received output
      const outputMessages = messages.filter((m: any) => m.type === 'terminal-output');
      expect(outputMessages.length).toBeGreaterThan(0);

      ws.close();
    });

    it.skip('should handle terminal input via WebSocket', async () => {
      // Create an interactive session
      const createResponse = await request(app)
        .post('/api/sessions')
        .send({
          command: ['sh'],
          workingDir: os.tmpdir(),
          name: 'Interactive Test',
        })
        .expect(200);

      const sessionId = createResponse.body.sessionId;
      activeSessionIds.push(sessionId);

      // Connect and send input
      const ws = new WebSocket(wsUrl);

      await new Promise<void>((resolve) => {
        ws.on('open', () => {
          // Send input
          ws.send(
            JSON.stringify({
              type: 'input',
              sessionId: sessionId,
              data: 'echo "Hello WebSocket"\n',
            })
          );
          resolve();
        });
      });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Get snapshot to verify input was processed
      const snapshotResponse = await request(app)
        .get(`/api/sessions/${sessionId}/snapshot`)
        .expect(200);

      const output = snapshotResponse.body.lines.join('\n');
      expect(output).toContain('Hello WebSocket');

      ws.close();
    });

    it.skip('should handle terminal resize via WebSocket', async () => {
      // Create a session
      const createResponse = await request(app)
        .post('/api/sessions')
        .send({
          command: ['sh'],
          workingDir: os.tmpdir(),
          name: 'Resize Test',
        })
        .expect(200);

      const sessionId = createResponse.body.sessionId;
      activeSessionIds.push(sessionId);

      // Connect and resize
      const ws = new WebSocket(wsUrl);

      await new Promise<void>((resolve) => {
        ws.on('open', () => {
          // Send resize
          ws.send(
            JSON.stringify({
              type: 'resize',
              sessionId: sessionId,
              cols: 120,
              rows: 40,
            })
          );
          resolve();
        });
      });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify resize (would need to check terminal dimensions)
      ws.close();
    });
  });

  describe('WebSocket Error Handling', () => {
    it('should handle malformed messages gracefully', async () => {
      const ws = new WebSocket(`${wsUrl}?hotReload=true`);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          // Send invalid JSON
          ws.send('invalid json {');

          // Should not crash the server
          setTimeout(() => {
            expect(ws.readyState).toBe(WebSocket.OPEN);
            ws.close();
            resolve();
          }, 100);
        });

        ws.on('error', reject);
      });
    });

    it('should handle connection drops', async () => {
      const ws = new WebSocket(`${wsUrl}?hotReload=true`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Abruptly terminate connection
      ws.terminate();

      // Server should continue functioning
      const response = await request(app).get('/api/sessions').expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('WebSocket Performance', () => {
    it('should handle rapid message sending', async () => {
      const ws = new WebSocket(`${wsUrl}?hotReload=true`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Send many messages rapidly
      const messageCount = 100;
      for (let i = 0; i < messageCount; i++) {
        ws.send(JSON.stringify({ type: 'test', index: i }));
      }

      // Should not crash or lose connection
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it('should handle large messages', async () => {
      const ws = new WebSocket(`${wsUrl}?hotReload=true`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Send a large message
      const largeData = 'x'.repeat(1024 * 1024); // 1MB
      ws.send(JSON.stringify({ type: 'test', data: largeData }));

      // Should handle it without issues
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });
  });
});
