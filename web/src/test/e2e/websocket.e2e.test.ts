import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { type ServerInstance, startTestServer, stopServer } from '../utils/server-utils';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('WebSocket Buffer Tests', () => {
  let server: ServerInstance | null = null;
  let sessionId: string;

  beforeAll(async () => {
    // Start server with no authentication
    server = await startTestServer({
      args: ['--port', '0', '--no-auth'],
      env: {},
      waitForHealth: true,
    });

    // Create a test session
    const createResponse = await fetch(`http://localhost:${server.port}/api/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        command: ['bash', '-c', 'while true; do echo "test output $RANDOM"; sleep 1; done'],
        workingDir: server.testDir,
        name: 'WebSocket Test Session',
      }),
    });

    const createResult = await createResponse.json();
    sessionId = createResult.sessionId;

    // Wait for session to start
    await sleep(500);
  });

  afterAll(async () => {
    if (server) {
      await stopServer(server.process);
    }
  });

  describe('WebSocket Connection', () => {
    it('should connect to WebSocket endpoint', async () => {
      const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          resolve();
        });
        ws.on('error', reject);
      });

      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });

    it('should accept connections without authentication when using --no-auth', async () => {
      const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          resolve();
        });
        ws.on('error', reject);
      });

      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });
  });

  describe('Buffer Subscription', () => {
    it('should subscribe to session buffers', async () => {
      const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Wait for welcome message
      await new Promise((resolve) => {
        ws.once('message', (data) => {
          const msg = JSON.parse(data.toString());
          expect(msg.type).toBe('connected');
          resolve(undefined);
        });
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
      expect(terminalView.getUint16(0, true)).toBe(0x5654); // "VT" in little-endian
      expect(terminalView.getUint8(2)).toBe(1); // Version

      ws.close();
    });

    it('should unsubscribe from session', async () => {
      const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Wait for welcome message
      await new Promise((resolve) => {
        ws.once('message', (data) => {
          const msg = JSON.parse(data.toString());
          expect(msg.type).toBe('connected');
          resolve(undefined);
        });
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

      // Should not receive more binary buffer messages
      let receivedBufferMessage = false;
      ws.on('message', (data: Buffer) => {
        // Only count binary messages (not JSON control messages)
        if (data.length > 0 && data.readUInt8(0) === 0xbf) {
          receivedBufferMessage = true;
        }
      });

      await sleep(2000); // Wait for potential messages
      expect(receivedBufferMessage).toBe(false);

      ws.close();
    });

    it('should handle multiple subscriptions', async () => {
      // Create another session
      const createResponse = await fetch(`http://localhost:${server?.port}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['bash', '-c', 'for i in {1..10}; do echo "session 2: $i"; sleep 0.5; done'],
          workingDir: server?.testDir,
          name: 'Second Session',
        }),
      });

      const { sessionId: sessionId2 } = await createResponse.json();

      const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Wait for welcome message
      await new Promise((resolve) => {
        ws.once('message', (data) => {
          const msg = JSON.parse(data.toString());
          expect(msg.type).toBe('connected');
          resolve(undefined);
        });
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
      const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

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
      const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Wait for welcome message
      await new Promise((resolve) => {
        ws.once('message', (data) => {
          const msg = JSON.parse(data.toString());
          expect(msg.type).toBe('connected');
          resolve(undefined);
        });
      });

      // Subscribe to non-existent session
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          sessionId: 'nonexistent',
        })
      );

      // The server creates a new terminal for non-existent sessions,
      // so we should receive a binary buffer with an empty terminal
      const response = await new Promise<Buffer>((resolve) => {
        ws.once('message', (data: Buffer) => {
          resolve(data);
        });
      });

      // Should be a binary buffer for the newly created terminal
      expect(response.readUInt8(0)).toBe(0xbf);

      // Verify it's a valid buffer
      const sessionIdLength = response.readUInt32LE(1);
      const extractedSessionId = response.slice(5, 5 + sessionIdLength).toString('utf8');
      expect(extractedSessionId).toBe('nonexistent');

      ws.close();
    });

    it('should handle missing sessionId in subscribe', async () => {
      const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

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
      await fetch(`http://localhost:${server?.port}/api/sessions/${sessionId}/input`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: '\x1b[2J\x1b[H' }), // Clear screen
      });

      await sleep(100);

      await fetch(`http://localhost:${server?.port}/api/sessions/${sessionId}/input`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: 'echo "Hello WebSocket"\n' }),
      });

      await sleep(500);

      const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Wait for welcome message
      await new Promise((resolve) => {
        ws.once('message', (data) => {
          const msg = JSON.parse(data.toString());
          expect(msg.type).toBe('connected');
          resolve(undefined);
        });
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
      expect(bufferMessage.readUInt8(0)).toBe(0xbf); // Magic byte
      const sessionIdLength = bufferMessage.readUInt32LE(1);
      const terminalBufferStart = 5 + sessionIdLength;
      const view = new DataView(
        bufferMessage.buffer,
        bufferMessage.byteOffset + terminalBufferStart,
        bufferMessage.byteLength - terminalBufferStart
      );

      // Verify header
      expect(view.getUint16(0, true)).toBe(0x5654); // Magic "VT" in little-endian
      expect(view.getUint8(2)).toBe(1); // Version

      // Read dimensions
      const cols = view.getUint32(4, true);
      const rows = view.getUint32(8, true);
      expect(cols).toBeGreaterThan(0);
      expect(rows).toBeGreaterThan(0);

      // Read cursor position
      const cursorX = view.getUint32(12, true);
      const cursorY = view.getUint32(16, true);
      expect(cursorX).toBeGreaterThanOrEqual(0);
      expect(cursorY).toBeGreaterThanOrEqual(0);

      ws.close();
    });
  });

  describe('Malformed Binary Data Edge Cases', () => {
    it('should handle raw binary data instead of JSON control messages', async () => {
      const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Send raw binary data that's not a valid control message
      const malformedBuffer = Buffer.from([0xff, 0xfe, 0xfd, 0xfc]);
      ws.send(malformedBuffer);

      // Connection should remain open
      await sleep(100);
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it('should handle truncated JSON messages', async () => {
      const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Send truncated JSON
      ws.send('{"type": "subscribe", "sess');

      // Connection should remain open
      await sleep(100);
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it('should handle oversized session ID in binary format', async () => {
      const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Subscribe to valid session first
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          sessionId: sessionId,
        })
      );

      // Wait for initial message
      await new Promise((resolve) => {
        ws.once('message', resolve);
      });

      // Send malformed binary data with invalid session ID length
      const malformedBuffer = Buffer.alloc(10);
      malformedBuffer.writeUInt8(0xbf, 0); // Magic byte
      malformedBuffer.writeUInt32LE(0xffffffff, 1); // Huge session ID length

      // This should not crash the server
      ws.send(malformedBuffer);

      // Connection should remain open
      await sleep(100);
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it('should handle empty binary messages', async () => {
      const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Send empty buffer
      ws.send(Buffer.alloc(0));

      // Connection should remain open
      await sleep(100);
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it('should handle messages with invalid UTF-8 in session ID', async () => {
      const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Send subscribe with invalid UTF-8 sequences
      const invalidUtf8 = Buffer.from([0xff, 0xfe, 0xfd]);
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          sessionId: invalidUtf8.toString('latin1'),
        })
      );

      // Connection should remain open
      await sleep(100);
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it('should handle extremely large control messages', async () => {
      const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Create a very large session ID (1MB)
      const largeSessionId = 'x'.repeat(1024 * 1024);
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          sessionId: largeSessionId,
        })
      );

      // Connection should remain open (though subscription won't work)
      await sleep(100);
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it('should handle mixed text and binary frames', async () => {
      const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Subscribe normally
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

      // Send binary data that looks like a control message
      const fakeBinaryControl = Buffer.from(
        JSON.stringify({ type: 'unsubscribe', sessionId: sessionId })
      );
      ws.send(fakeBinaryControl, { binary: true });

      // Should still receive updates
      let receivedUpdate = false;
      ws.on('message', (data: Buffer) => {
        if (data.length > 0 && data.readUInt8(0) === 0xbf) {
          receivedUpdate = true;
        }
      });

      // Trigger an update
      await fetch(`http://localhost:${server?.port}/api/sessions/${sessionId}/input`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: 'test\n' }),
      });

      await sleep(500);
      expect(receivedUpdate).toBe(true);

      ws.close();
    });

    it('should handle null bytes in JSON messages', async () => {
      const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Send JSON with null bytes
      const messageWithNull = `{"type": "subscribe", "sessionId": "test\x00session"}`;
      ws.send(messageWithNull);

      // Connection should remain open
      await sleep(100);
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it('should handle malformed terminal buffer in received data', async () => {
      const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      let errorOccurred = false;
      ws.on('error', () => {
        errorOccurred = true;
      });

      // Subscribe to session
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          sessionId: sessionId,
        })
      );

      // Wait for buffer messages and ensure they're valid
      const messages: Buffer[] = [];
      await new Promise<void>((resolve) => {
        const messageHandler = (data: Buffer) => {
          messages.push(data);
          if (messages.length >= 2) {
            ws.off('message', messageHandler);
            resolve();
          }
        };
        ws.on('message', messageHandler);

        // Trigger some output
        fetch(`http://localhost:${server?.port}/api/sessions/${sessionId}/input`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ data: 'echo "test1"\necho "test2"\n' }),
        });
      });

      // Verify all received messages are properly formatted
      for (const msg of messages) {
        if (msg.length > 0 && msg.readUInt8(0) === 0xbf) {
          // It's a binary buffer message
          expect(msg.length).toBeGreaterThan(5); // At least magic + length + some data
          const sessionIdLength = msg.readUInt32LE(1);
          expect(sessionIdLength).toBeGreaterThan(0);
          expect(sessionIdLength).toBeLessThan(1000); // Reasonable limit
          expect(msg.length).toBeGreaterThan(5 + sessionIdLength); // Has terminal data
        }
      }

      expect(errorOccurred).toBe(false);
      ws.close();
    });

    it('should handle rapid malformed message spam', async () => {
      const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Spam various malformed messages
      for (let i = 0; i < 100; i++) {
        if (i % 4 === 0) {
          ws.send('invalid json');
        } else if (i % 4 === 1) {
          ws.send(Buffer.from([0xff, 0xfe, i]));
        } else if (i % 4 === 2) {
          ws.send(`{"type": "unknown_${i}"}`);
        } else {
          ws.send(Buffer.alloc(0));
        }
      }

      // Connection should remain open
      await sleep(200);
      expect(ws.readyState).toBe(WebSocket.OPEN);

      // Should still be able to subscribe normally
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          sessionId: sessionId,
        })
      );

      // Should receive a buffer message
      const bufferMessage = await new Promise<Buffer>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 2000);
        ws.once('message', (data: Buffer) => {
          clearTimeout(timeout);
          resolve(data);
        });
      });

      expect(bufferMessage).toBeInstanceOf(Buffer);
      expect(bufferMessage.readUInt8(0)).toBe(0xbf);

      ws.close();
    });
  });

  describe('Connection Lifecycle', () => {
    it('should handle client disconnect gracefully', async () => {
      const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

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
      const healthResponse = await fetch(`http://localhost:${server?.port}/api/health`);
      expect(healthResponse.ok).toBe(true);
    });

    it('should handle rapid connect/disconnect', async () => {
      for (let i = 0; i < 5; i++) {
        const ws = new WebSocket(`ws://localhost:${server?.port}/buffers`);

        await new Promise<void>((resolve) => {
          ws.on('open', resolve);
        });

        ws.close();
        await sleep(50);
      }

      // Server should still be healthy
      const healthResponse = await fetch(`http://localhost:${server?.port}/api/health`);
      expect(healthResponse.ok).toBe(true);
    });
  });
});
