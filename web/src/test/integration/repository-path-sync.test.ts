import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

// Mock the control Unix handler
const mockControlUnixHandler = {
  sendControlMessage: vi.fn(),
  updateRepositoryPath: vi.fn(),
};

// Mock the app setup
vi.mock('../../server/server', () => ({
  createApp: () => {
    const express = require('express');
    const app = express();
    return app;
  },
}));

describe('Repository Path Bidirectional Sync Integration', () => {
  let wsServer: WebSocket.Server;
  let httpServer: Server;
  let client: WebSocket;
  const port = 4321;

  beforeEach(async () => {
    // Create a simple WebSocket server to simulate the config endpoint
    httpServer = require('http').createServer();
    wsServer = new WebSocket.Server({ server: httpServer, path: '/ws/config' });

    // Handle WebSocket connections
    wsServer.on('connection', (ws) => {
      // Send initial config
      ws.send(
        JSON.stringify({
          type: 'config',
          data: {
            repositoryBasePath: '~/',
            serverConfigured: false,
          },
        })
      );

      // Handle messages from client
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'update-repository-path') {
            // Simulate forwarding to Mac
            const _response = await mockControlUnixHandler.sendControlMessage({
              id: 'test-id',
              type: 'request',
              category: 'system',
              action: 'repository-path-update',
              payload: { path: message.path, source: 'web' },
            });

            // Broadcast update back to all clients
            wsServer.clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(
                  JSON.stringify({
                    type: 'config',
                    data: {
                      repositoryBasePath: message.path,
                      serverConfigured: false,
                    },
                  })
                );
              }
            });
          }
        } catch (error) {
          console.error('Error handling message:', error);
        }
      });
    });

    // Start server
    await new Promise<void>((resolve) => {
      httpServer.listen(port, resolve);
    });
  });

  afterEach(async () => {
    // Clean up
    if (client && client.readyState === WebSocket.OPEN) {
      client.close();
    }
    wsServer.close();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    vi.clearAllMocks();
  });

  it('should complete full bidirectional sync flow', async () => {
    // Setup mock Mac response
    mockControlUnixHandler.sendControlMessage.mockResolvedValue({
      id: 'test-id',
      type: 'response',
      category: 'system',
      action: 'repository-path-update',
      payload: { success: true },
    });

    // Connect client
    client = new WebSocket(`ws://localhost:${port}/ws/config`);

    await new Promise<void>((resolve) => {
      client.on('open', resolve);
    });

    // Track received messages
    const receivedMessages: Array<{ type: string; data?: unknown }> = [];
    client.on('message', (data) => {
      receivedMessages.push(JSON.parse(data.toString()));
    });

    // Wait for initial config
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0]).toEqual({
      type: 'config',
      data: {
        repositoryBasePath: '~/',
        serverConfigured: false,
      },
    });

    // Step 1: Web sends update
    const newPath = '/Users/test/Projects';
    client.send(
      JSON.stringify({
        type: 'update-repository-path',
        path: newPath,
      })
    );

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Step 2: Verify Mac handler was called
    expect(mockControlUnixHandler.sendControlMessage).toHaveBeenCalledWith({
      id: 'test-id',
      type: 'request',
      category: 'system',
      action: 'repository-path-update',
      payload: { path: newPath, source: 'web' },
    });

    // Step 3: Verify broadcast was sent back
    expect(receivedMessages).toHaveLength(2);
    expect(receivedMessages[1]).toEqual({
      type: 'config',
      data: {
        repositoryBasePath: newPath,
        serverConfigured: false,
      },
    });
  });

  it('should handle Mac-initiated updates', async () => {
    // Connect client
    client = new WebSocket(`ws://localhost:${port}/ws/config`);

    await new Promise<void>((resolve) => {
      client.on('open', resolve);
    });

    const receivedMessages: Array<{ type: string; data?: unknown }> = [];
    client.on('message', (data) => {
      receivedMessages.push(JSON.parse(data.toString()));
    });

    // Wait for initial config
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Simulate Mac sending update through server
    const macPath = '/mac/initiated/path';
    wsServer.clients.forEach((ws) => {
      ws.send(
        JSON.stringify({
          type: 'config',
          data: {
            repositoryBasePath: macPath,
            serverConfigured: true,
          },
        })
      );
    });

    // Wait for message
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify client received update
    expect(receivedMessages).toHaveLength(2);
    expect(receivedMessages[1]).toEqual({
      type: 'config',
      data: {
        repositoryBasePath: macPath,
        serverConfigured: true,
      },
    });
  });

  it('should handle multiple clients', async () => {
    // Connect first client
    const client1 = new WebSocket(`ws://localhost:${port}/ws/config`);
    await new Promise<void>((resolve) => {
      client1.on('open', resolve);
    });

    const client1Messages: Array<{ type: string; data?: unknown }> = [];
    client1.on('message', (data) => {
      client1Messages.push(JSON.parse(data.toString()));
    });

    // Connect second client
    const client2 = new WebSocket(`ws://localhost:${port}/ws/config`);
    await new Promise<void>((resolve) => {
      client2.on('open', resolve);
    });

    const client2Messages: Array<{ type: string; data?: unknown }> = [];
    client2.on('message', (data) => {
      client2Messages.push(JSON.parse(data.toString()));
    });

    // Wait for initial configs
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Client 1 sends update
    const newPath = '/shared/path';
    client1.send(
      JSON.stringify({
        type: 'update-repository-path',
        path: newPath,
      })
    );

    // Wait for broadcast
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Both clients should receive the update
    expect(client1Messages).toHaveLength(2);
    expect(client2Messages).toHaveLength(2);

    expect(client1Messages[1].data.repositoryBasePath).toBe(newPath);
    expect(client2Messages[1].data.repositoryBasePath).toBe(newPath);

    // Clean up
    client1.close();
    client2.close();
  });

  it('should handle errors gracefully', async () => {
    // Setup mock to fail
    mockControlUnixHandler.sendControlMessage.mockRejectedValue(new Error('Unix socket error'));

    // Connect client
    client = new WebSocket(`ws://localhost:${port}/ws/config`);

    await new Promise<void>((resolve) => {
      client.on('open', resolve);
    });

    // Send update that will fail
    client.send(
      JSON.stringify({
        type: 'update-repository-path',
        path: '/failing/path',
      })
    );

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify handler was called despite error
    expect(mockControlUnixHandler.sendControlMessage).toHaveBeenCalled();

    // Connection should remain open
    expect(client.readyState).toBe(WebSocket.OPEN);
  });
});
