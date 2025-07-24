import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { HQConfig } from '../config';
import { HQClient } from './hq-client';

// Mock the logger
vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('HQClient', () => {
  let client: HQClient;
  let mockServer: WebSocketServer;
  let mockConfig: HQConfig;
  let serverUrl: string;
  let serverReceivedMessages: unknown[] = [];

  beforeEach(async () => {
    // Create a mock WebSocket server
    mockServer = new WebSocketServer({ port: 0 });
    const address = mockServer.address() as { port: number };
    serverUrl = `ws://localhost:${address.port}`;

    // Reset received messages
    serverReceivedMessages = [];

    // Set up server message handling
    mockServer.on('connection', (ws) => {
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        serverReceivedMessages.push(message);

        // Mock server responses
        if (message.type === 'register') {
          ws.send(
            JSON.stringify({
              type: 'registered',
              serverId: 'test-server-123',
            })
          );
        }
      });
    });

    // Create mock config
    mockConfig = {
      url: serverUrl,
      serverId: 'test-server-id',
      token: 'test-token',
      serverUrl: 'https://test.example.com',
      serverName: 'Test Server',
    };

    // Create client instance
    client = new HQClient(mockConfig);
  });

  afterEach(async () => {
    // Disconnect client
    await client.disconnect();

    // Close mock server
    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve());
    });

    vi.clearAllMocks();
  });

  describe('connection management', () => {
    it('should connect to HQ server', async () => {
      await client.connect();

      // Wait for connection and registration
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(client.isConnected()).toBe(true);
      expect(serverReceivedMessages).toHaveLength(1);
      expect(serverReceivedMessages[0]).toEqual({
        type: 'register',
        serverId: 'test-server-id',
        token: 'test-token',
        serverUrl: 'https://test.example.com',
        serverName: 'Test Server',
      });
    });

    it('should handle connection errors', async () => {
      // Close server before connecting
      await new Promise<void>((resolve) => {
        mockServer.close(() => resolve());
      });

      await client.connect();

      // Client should handle error gracefully
      expect(client.isConnected()).toBe(false);
    });

    it('should handle disconnection', async () => {
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(client.isConnected()).toBe(true);

      await client.disconnect();

      expect(client.isConnected()).toBe(false);
    });

    it('should not throw when disconnecting without connection', async () => {
      // Should not throw
      await expect(client.disconnect()).resolves.toBeUndefined();
    });
  });

  describe('message handling', () => {
    beforeEach(async () => {
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it('should forward session updates to HQ', async () => {
      const sessionUpdate = {
        id: 'session-123',
        status: 'running',
        name: 'Test Session',
      };

      await client.sendSessionUpdate('session-123', sessionUpdate);

      // Wait for message to be sent
      await new Promise((resolve) => setTimeout(resolve, 50));

      const sentMessage = serverReceivedMessages.find((msg) => msg.type === 'sessionUpdate');
      expect(sentMessage).toEqual({
        type: 'sessionUpdate',
        sessionId: 'session-123',
        update: sessionUpdate,
      });
    });

    it('should handle ping/pong messages', async () => {
      // Mock server sending ping
      mockServer.clients.forEach((ws) => {
        ws.send(JSON.stringify({ type: 'ping' }));
      });

      // Wait for pong response
      await new Promise((resolve) => setTimeout(resolve, 50));

      const pongMessage = serverReceivedMessages.find((msg) => msg.type === 'pong');
      expect(pongMessage).toBeDefined();
    });

    it('should ignore messages when not connected', async () => {
      await client.disconnect();

      // This should not throw
      await client.sendSessionUpdate('session-456', { status: 'exited' });

      // No new messages should be sent
      const messageCountBefore = serverReceivedMessages.length;
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(serverReceivedMessages.length).toBe(messageCountBefore);
    });
  });

  describe('reconnection logic', () => {
    it('should attempt to reconnect after connection loss', async () => {
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const initialMessageCount = serverReceivedMessages.length;

      // Simulate connection loss by closing all connections
      mockServer.clients.forEach((ws) => ws.close());

      // Wait for reconnection attempt
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Should have sent another register message
      expect(serverReceivedMessages.length).toBeGreaterThan(initialMessageCount);
      const registerMessages = serverReceivedMessages.filter((msg) => msg.type === 'register');
      expect(registerMessages.length).toBeGreaterThan(1);
    });

    it('should not reconnect after manual disconnect', async () => {
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 100));

      await client.disconnect();

      const messageCountAfterDisconnect = serverReceivedMessages.length;

      // Wait to ensure no reconnection happens
      await new Promise((resolve) => setTimeout(resolve, 1500));

      expect(serverReceivedMessages.length).toBe(messageCountAfterDisconnect);
    });
  });

  describe('getHQAuth', () => {
    it('should generate correct Basic auth header', () => {
      const authHeader = client.getHQAuth();

      // Decode the Basic auth header
      const expectedAuth = Buffer.from(`test-server-id:test-token`).toString('base64');
      expect(authHeader).toBe(`Basic ${expectedAuth}`);
    });

    it('should handle special characters in credentials', () => {
      const specialConfig: HQConfig = {
        ...mockConfig,
        serverId: 'server:with:colons',
        token: 'token@with#special$chars',
      };

      const specialClient = new HQClient(specialConfig);
      const authHeader = specialClient.getHQAuth();

      const expectedAuth = Buffer.from(`server:with:colons:token@with#special$chars`).toString(
        'base64'
      );
      expect(authHeader).toBe(`Basic ${expectedAuth}`);
    });
  });

  describe('error handling', () => {
    it('should handle WebSocket errors gracefully', async () => {
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Trigger an error on the WebSocket
      const ws = Array.from(mockServer.clients)[0];
      ws.emit('error', new Error('Test WebSocket error'));

      // Client should handle error without crashing
      // May trigger reconnection
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should still be able to disconnect cleanly
      await expect(client.disconnect()).resolves.toBeUndefined();
    });

    it('should handle invalid JSON messages', async () => {
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send invalid JSON
      mockServer.clients.forEach((ws) => {
        ws.send('invalid json {');
      });

      // Should not crash
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(client.isConnected()).toBe(true);
    });

    it('should handle connection timeout', async () => {
      // Create a server that doesn't respond to registration
      const silentServer = new WebSocketServer({ port: 0 });
      const silentAddress = silentServer.address() as { port: number };
      const silentUrl = `ws://localhost:${silentAddress.port}`;

      silentServer.on('connection', () => {
        // Don't send any response
      });

      const timeoutConfig: HQConfig = {
        ...mockConfig,
        url: silentUrl,
      };

      const timeoutClient = new HQClient(timeoutConfig);
      await timeoutClient.connect();

      // Should handle timeout gracefully
      await new Promise((resolve) => setTimeout(resolve, 100));

      await timeoutClient.disconnect();
      await new Promise<void>((resolve) => {
        silentServer.close(() => resolve());
      });
    });
  });

  describe('session management', () => {
    beforeEach(async () => {
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it('should send session creation notification', async () => {
      const sessionInfo = {
        id: 'new-session-789',
        name: 'New Session',
        command: ['bash'],
        workingDir: '/home/user',
      };

      await client.sendSessionUpdate('new-session-789', {
        status: 'created',
        ...sessionInfo,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const message = serverReceivedMessages.find(
        (msg) => msg.type === 'sessionUpdate' && msg.update.status === 'created'
      );
      expect(message).toBeDefined();
      expect(message.sessionId).toBe('new-session-789');
    });

    it('should send session exit notification', async () => {
      await client.sendSessionUpdate('exit-session-999', {
        status: 'exited',
        exitCode: 0,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const message = serverReceivedMessages.find(
        (msg) => msg.type === 'sessionUpdate' && msg.update.status === 'exited'
      );
      expect(message).toBeDefined();
      expect(message.update.exitCode).toBe(0);
    });
  });
});
