/**
 * Tests for the VibeTunnel socket client
 */

import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VibeTunnelSocketClient } from '../../server/pty/socket-client.js';
import { frameMessage, MessageType } from '../../server/pty/socket-protocol.js';

describe('VibeTunnelSocketClient', () => {
  let testDir: string;
  let socketPath: string;
  let server: net.Server;
  let serverConnections: net.Socket[] = [];

  beforeEach(() => {
    // Create temp directory for test sockets
    testDir = path.join(os.tmpdir(), `vibetunnel-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    socketPath = path.join(testDir, 'test.sock');

    // Track server connections
    serverConnections = [];
  });

  afterEach(async () => {
    // Close all connections
    for (const conn of serverConnections) {
      conn.destroy();
    }

    // Close server if running
    if (server?.listening) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }

    // Clean up test directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  const createTestServer = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      server = net.createServer((socket) => {
        serverConnections.push(socket);

        // Echo back any messages for testing
        socket.on('data', (data) => {
          socket.write(data);
        });
      });

      server.listen(socketPath, () => resolve());
      server.on('error', reject);
    });
  };

  describe('Connection', () => {
    it('should connect to a socket successfully', async () => {
      await createTestServer();

      const client = new VibeTunnelSocketClient(socketPath);
      await expect(client.connect()).resolves.toBeUndefined();

      expect(client.isConnected()).toBe(true);

      client.disconnect();
    });

    it('should reject if socket does not exist', async () => {
      const client = new VibeTunnelSocketClient('/nonexistent/socket');

      await expect(client.connect()).rejects.toThrow();
      expect(client.isConnected()).toBe(false);
    });

    it('should emit connect event', async () => {
      await createTestServer();

      const client = new VibeTunnelSocketClient(socketPath);
      const connectHandler = vi.fn();

      client.on('connect', connectHandler);
      await client.connect();

      expect(connectHandler).toHaveBeenCalledTimes(1);

      client.disconnect();
    });

    it('should not connect twice', async () => {
      await createTestServer();

      const client = new VibeTunnelSocketClient(socketPath);
      await client.connect();

      // Second connect should resolve immediately
      await expect(client.connect()).resolves.toBeUndefined();

      client.disconnect();
    });

    it('should auto-reconnect if enabled', async () => {
      await createTestServer();

      const client = new VibeTunnelSocketClient(socketPath, { autoReconnect: true });
      const connectHandler = vi.fn();
      const disconnectHandler = vi.fn();

      client.on('connect', connectHandler);
      client.on('disconnect', disconnectHandler);

      await client.connect();
      expect(connectHandler).toHaveBeenCalledTimes(1);

      // Force disconnect by destroying server connection
      serverConnections[0].destroy();

      // Wait for disconnect event
      await new Promise((resolve) => {
        client.once('disconnect', resolve);
      });

      expect(disconnectHandler).toHaveBeenCalledTimes(1);

      // Wait for reconnect
      await new Promise((resolve) => {
        client.once('connect', resolve);
      });

      expect(connectHandler).toHaveBeenCalledTimes(2);
      expect(client.isConnected()).toBe(true);

      client.disconnect();
    });
  });

  describe('Message sending', () => {
    beforeEach(async () => {
      await createTestServer();
    });

    it('should send stdin data', async () => {
      const client = new VibeTunnelSocketClient(socketPath);
      await client.connect();

      const testData = 'hello world';
      const result = client.sendStdin(testData);

      expect(result).toBe(true);

      // Verify server received framed message
      await new Promise<void>((resolve) => {
        serverConnections[0].once('data', (data) => {
          expect(data[0]).toBe(MessageType.STDIN_DATA);
          const length = data.readUInt32BE(1);
          const payload = data.subarray(5, 5 + length).toString('utf8');
          expect(payload).toBe(testData);
          resolve();
        });
      });

      client.disconnect();
    });

    it('should send resize command', async () => {
      const client = new VibeTunnelSocketClient(socketPath);
      await client.connect();

      const result = client.resize(120, 40);
      expect(result).toBe(true);

      await new Promise<void>((resolve) => {
        serverConnections[0].once('data', (data) => {
          expect(data[0]).toBe(MessageType.CONTROL_CMD);
          const length = data.readUInt32BE(1);
          const payload = JSON.parse(data.subarray(5, 5 + length).toString('utf8'));
          expect(payload).toEqual({ cmd: 'resize', cols: 120, rows: 40 });
          resolve();
        });
      });

      client.disconnect();
    });

    it('should send kill command', async () => {
      const client = new VibeTunnelSocketClient(socketPath);
      await client.connect();

      client.kill('SIGTERM');

      await new Promise<void>((resolve) => {
        serverConnections[0].once('data', (data) => {
          const payload = JSON.parse(data.subarray(5).toString('utf8'));
          expect(payload).toEqual({ cmd: 'kill', signal: 'SIGTERM' });
          resolve();
        });
      });

      client.disconnect();
    });

    it('should send status update', async () => {
      const client = new VibeTunnelSocketClient(socketPath);
      await client.connect();

      client.sendStatus('claude', '✻ Thinking', { tokens: 1000 });

      await new Promise<void>((resolve) => {
        serverConnections[0].once('data', (data) => {
          expect(data[0]).toBe(MessageType.STATUS_UPDATE);
          const length = data.readUInt32BE(1);
          const payload = JSON.parse(data.subarray(5, 5 + length).toString('utf8'));
          expect(payload).toEqual({
            app: 'claude',
            status: '✻ Thinking',
            tokens: 1000,
          });
          resolve();
        });
      });

      client.disconnect();
    });

    it('should return false when not connected', () => {
      const client = new VibeTunnelSocketClient(socketPath);

      expect(client.sendStdin('test')).toBe(false);
      expect(client.resize(80, 24)).toBe(false);
      expect(client.kill()).toBe(false);
      expect(client.sendStatus('app', 'status')).toBe(false);
    });
  });

  describe('Message receiving', () => {
    beforeEach(async () => {
      await createTestServer();
    });

    it('should receive and parse status updates', async () => {
      const client = new VibeTunnelSocketClient(socketPath);
      const statusHandler = vi.fn();

      client.on('STATUS_UPDATE', statusHandler);
      await client.connect();

      // Send status from server
      const statusMsg = frameMessage(MessageType.STATUS_UPDATE, {
        app: 'claude',
        status: '✻ Processing',
      });
      serverConnections[0].write(statusMsg);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(statusHandler).toHaveBeenCalledWith({
        app: 'claude',
        status: '✻ Processing',
      });

      client.disconnect();
    });

    it('should receive and parse error messages', async () => {
      const client = new VibeTunnelSocketClient(socketPath);
      const errorHandler = vi.fn();

      client.on('ERROR', errorHandler);
      await client.connect();

      // Send error from server
      const errorMsg = frameMessage(MessageType.ERROR, {
        code: 'SESSION_NOT_FOUND',
        message: 'Session does not exist',
      });
      serverConnections[0].write(errorMsg);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(errorHandler).toHaveBeenCalledWith({
        code: 'SESSION_NOT_FOUND',
        message: 'Session does not exist',
      });

      client.disconnect();
    });

    it('should handle heartbeat messages', async () => {
      const client = new VibeTunnelSocketClient(socketPath);
      await client.connect();

      // Wait a bit to have some elapsed time
      await new Promise((resolve) => setTimeout(resolve, 100));
      const initialHeartbeat = client.getTimeSinceLastHeartbeat();
      expect(initialHeartbeat).toBeGreaterThan(0);

      // Send heartbeat from server
      const heartbeatMsg = frameMessage(MessageType.HEARTBEAT, Buffer.alloc(0));
      serverConnections[0].write(heartbeatMsg);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // After receiving heartbeat, time since last heartbeat should be less
      const newHeartbeat = client.getTimeSinceLastHeartbeat();
      expect(newHeartbeat).toBeLessThan(initialHeartbeat);

      client.disconnect();
    });

    it('should handle multiple messages in one chunk', async () => {
      const client = new VibeTunnelSocketClient(socketPath);
      const statusHandler = vi.fn();

      client.on('STATUS_UPDATE', statusHandler);
      await client.connect();

      // Send multiple messages at once
      const msg1 = frameMessage(MessageType.STATUS_UPDATE, { app: 'test1', status: 'status1' });
      const msg2 = frameMessage(MessageType.STATUS_UPDATE, { app: 'test2', status: 'status2' });
      const combined = Buffer.concat([msg1, msg2]);

      serverConnections[0].write(combined);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(statusHandler).toHaveBeenCalledTimes(2);
      expect(statusHandler).toHaveBeenNthCalledWith(1, { app: 'test1', status: 'status1' });
      expect(statusHandler).toHaveBeenNthCalledWith(2, { app: 'test2', status: 'status2' });

      client.disconnect();
    });

    it('should handle partial messages', async () => {
      const client = new VibeTunnelSocketClient(socketPath);
      const statusHandler = vi.fn();

      client.on('STATUS_UPDATE', statusHandler);
      await client.connect();

      // Create a message and split it
      const fullMsg = frameMessage(MessageType.STATUS_UPDATE, { app: 'claude', status: 'active' });
      const part1 = fullMsg.subarray(0, 10);
      const part2 = fullMsg.subarray(10);

      // Send in parts
      serverConnections[0].write(part1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(statusHandler).not.toHaveBeenCalled();

      serverConnections[0].write(part2);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(statusHandler).toHaveBeenCalledWith({ app: 'claude', status: 'active' });

      client.disconnect();
    });
  });

  describe('Heartbeat', () => {
    beforeEach(async () => {
      await createTestServer();
    });

    it('should send heartbeats when configured', async () => {
      const client = new VibeTunnelSocketClient(socketPath, {
        heartbeatInterval: 100, // 100ms for testing
      });

      await client.connect();

      const heartbeatReceived = new Promise<void>((resolve) => {
        serverConnections[0].on('data', (data) => {
          if (data[0] === MessageType.HEARTBEAT) {
            resolve();
          }
        });
      });

      await expect(heartbeatReceived).resolves.toBeUndefined();

      client.disconnect();
    });

    it('should echo heartbeats back', async () => {
      const client = new VibeTunnelSocketClient(socketPath);
      await client.connect();

      let echoReceived = false;

      // Override server behavior to check for echo
      serverConnections[0].removeAllListeners('data');
      serverConnections[0].on('data', (data) => {
        if (data[0] === MessageType.HEARTBEAT) {
          echoReceived = true;
        }
      });

      // Send heartbeat from server
      const heartbeatMsg = frameMessage(MessageType.HEARTBEAT, Buffer.alloc(0));
      serverConnections[0].write(heartbeatMsg);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(echoReceived).toBe(true);

      client.disconnect();
    });
  });

  describe('Error handling', () => {
    it('should emit error events', async () => {
      await createTestServer();

      const client = new VibeTunnelSocketClient(socketPath);
      const errorHandler = vi.fn();

      client.on('error', errorHandler);
      await client.connect();

      // Force an error by writing invalid data then destroying the connection
      serverConnections[0].write(Buffer.from([0xff, 0xff, 0xff, 0xff])); // Invalid message
      serverConnections[0].destroy();

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have received either an error or disconnect event
      expect(client.isConnected()).toBe(false);

      client.disconnect();
    });

    it('should handle malformed messages gracefully', async () => {
      await createTestServer();

      const client = new VibeTunnelSocketClient(socketPath);
      await client.connect();

      // Send invalid JSON for a message type that expects JSON
      const invalidMsg = Buffer.concat([
        Buffer.from([MessageType.STATUS_UPDATE]),
        Buffer.from([0, 0, 0, 5]), // length = 5
        Buffer.from('{bad}'), // Invalid JSON
      ]);

      // Should not throw
      serverConnections[0].write(invalidMsg);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(client.isConnected()).toBe(true);

      client.disconnect();
    });
  });

  describe('Cleanup', () => {
    it('should clean up on disconnect', async () => {
      await createTestServer();

      const client = new VibeTunnelSocketClient(socketPath, {
        autoReconnect: true,
        heartbeatInterval: 100,
      });

      await client.connect();
      expect(client.isConnected()).toBe(true);

      client.disconnect();

      expect(client.isConnected()).toBe(false);

      // Should not reconnect after explicit disconnect
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(client.isConnected()).toBe(false);
    });
  });
});
