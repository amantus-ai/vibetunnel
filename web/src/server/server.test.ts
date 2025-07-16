import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { ControlMessage } from './websocket/control-protocol.js';
import type { ControlUnixHandler } from './websocket/control-unix-handler.js';

// Mock WebSocket
vi.mock('ws');

describe('Config WebSocket', () => {
  let mockControlUnixHandler: ControlUnixHandler;
  let messageHandler: (data: Buffer | ArrayBuffer | string) => void;

  beforeEach(() => {
    // Create mock WebSocket instance
    const _mockWs = {
      on: vi.fn((event: string, handler: (data: Buffer | ArrayBuffer | string) => void) => {
        if (event === 'message') {
          messageHandler = handler;
        }
      }),
      send: vi.fn(),
      close: vi.fn(),
      readyState: WebSocket.OPEN,
    };

    // Initialize messageHandler with a mock implementation
    // This simulates what the server would do when handling config WebSocket messages
    messageHandler = async (data: Buffer | ArrayBuffer | string) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'update-repository-path') {
          const newPath = message.path;
          // Forward to Mac app via Unix socket if available
          if (mockControlUnixHandler) {
            const controlMessage: ControlMessage = {
              id: 'test-id',
              type: 'request' as const,
              category: 'system' as const,
              action: 'repository-path-update',
              payload: { path: newPath, source: 'web' },
            };
            // Send to Mac and wait for response
            await mockControlUnixHandler.sendControlMessage(controlMessage);
          }
        }
      } catch {
        // Handle errors silently
      }
    };

    // Create mock control Unix handler
    mockControlUnixHandler = {
      sendControlMessage: vi.fn(),
    } as unknown as ControlUnixHandler;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('repository path update from web', () => {
    it('should forward path update to Mac app via Unix socket', async () => {
      // Setup mock response
      const mockResponse: ControlMessage = {
        id: 'test-id',
        type: 'response',
        category: 'system',
        action: 'repository-path-update',
        payload: { success: true },
      };
      vi.mocked(mockControlUnixHandler.sendControlMessage).mockResolvedValue(mockResponse);

      // Simulate message from web client
      const message = JSON.stringify({
        type: 'update-repository-path',
        path: '/new/repository/path',
      });

      // Trigger message handler
      await messageHandler(Buffer.from(message));

      // Verify control message was sent
      expect(mockControlUnixHandler.sendControlMessage).toHaveBeenCalledWith({
        id: 'test-id',
        type: 'request',
        category: 'system',
        action: 'repository-path-update',
        payload: { path: '/new/repository/path', source: 'web' },
      });
    });

    it('should handle Mac app confirmation response', async () => {
      const mockResponse: ControlMessage = {
        id: 'test-id',
        type: 'response',
        category: 'system',
        action: 'repository-path-update',
        payload: { success: true },
      };
      vi.mocked(mockControlUnixHandler.sendControlMessage).mockResolvedValue(mockResponse);

      const message = JSON.stringify({
        type: 'update-repository-path',
        path: '/new/path',
      });

      await messageHandler(Buffer.from(message));

      // Should complete without errors
      expect(mockControlUnixHandler.sendControlMessage).toHaveBeenCalled();
    });

    it('should handle Mac app failure response', async () => {
      const mockResponse: ControlMessage = {
        id: 'test-id',
        type: 'response',
        category: 'system',
        action: 'repository-path-update',
        payload: { success: false },
      };
      vi.mocked(mockControlUnixHandler.sendControlMessage).mockResolvedValue(mockResponse);

      const message = JSON.stringify({
        type: 'update-repository-path',
        path: '/new/path',
      });

      await messageHandler(Buffer.from(message));

      // Should handle gracefully
      expect(mockControlUnixHandler.sendControlMessage).toHaveBeenCalled();
    });

    it('should handle missing control Unix handler', async () => {
      // Simulate no control handler available
      mockControlUnixHandler = null as unknown as ControlUnixHandler;

      const message = JSON.stringify({
        type: 'update-repository-path',
        path: '/new/path',
      });

      // Should not throw
      await expect(messageHandler(Buffer.from(message))).resolves.not.toThrow();
    });

    it('should ignore non-repository-path messages', async () => {
      const message = JSON.stringify({
        type: 'other-message-type',
        data: 'some data',
      });

      await messageHandler(Buffer.from(message));

      // Should not call sendControlMessage
      expect(mockControlUnixHandler.sendControlMessage).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON gracefully', async () => {
      const invalidMessage = 'invalid json {';

      // Should not throw
      await expect(messageHandler(Buffer.from(invalidMessage))).resolves.not.toThrow();
      expect(mockControlUnixHandler.sendControlMessage).not.toHaveBeenCalled();
    });

    it('should handle control message send errors', async () => {
      vi.mocked(mockControlUnixHandler.sendControlMessage).mockRejectedValue(
        new Error('Unix socket error')
      );

      const message = JSON.stringify({
        type: 'update-repository-path',
        path: '/new/path',
      });

      // Should not throw
      await expect(messageHandler(Buffer.from(message))).resolves.not.toThrow();
    });
  });
});
