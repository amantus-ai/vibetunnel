import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { StreamHandler } from '../../../server/capture/stream-handler.js';
import { createLogger } from '../../../server/utils/logger.js';

vi.mock('../../../server/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));
vi.mock('ws');

describe('StreamHandler', () => {
  let streamHandler: StreamHandler;
  let mockLogger: any;
  let mockWebSocket: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    vi.mocked(createLogger).mockReturnValue(mockLogger);

    // Create mock WebSocket
    mockWebSocket = {
      id: 'test-client-id',
      readyState: WebSocket.OPEN,
      send: vi.fn((_data, callback) => {
        if (callback) callback();
      }),
      on: vi.fn(),
      once: vi.fn(),
      removeListener: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
    };

    streamHandler = new StreamHandler('session-123');
  });

  describe('addClient', () => {
    it('should add a new WebSocket client', () => {
      streamHandler.addClient('client-1', mockWebSocket, 'session-123');

      expect(streamHandler.getClientCount()).toBe(1);
      expect(mockWebSocket.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockWebSocket.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockWebSocket.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should handle client close event', () => {
      streamHandler.addClient('client-1', mockWebSocket, 'session-123');

      // Simulate close event
      const closeCallback = mockWebSocket.on.mock.calls.find(
        (call: any) => call[0] === 'close'
      )?.[1];
      closeCallback?.();

      expect(streamHandler.getClientCount()).toBe(0);
      expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Client disconnected'));
    });

    it('should handle client error event', () => {
      streamHandler.addClient('client-1', mockWebSocket, 'session-123');

      // Simulate error event
      const errorCallback = mockWebSocket.on.mock.calls.find(
        (call: any) => call[0] === 'error'
      )?.[1];
      const testError = new Error('WebSocket error');
      errorCallback?.(testError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Client client-1 error'),
        testError
      );
    });

    it('should not add duplicate clients', () => {
      streamHandler.addClient('client-1', mockWebSocket, 'session-123');
      streamHandler.addClient('client-1', mockWebSocket, 'session-123'); // Add same client again

      expect(streamHandler.getClientCount()).toBe(1);
    });
  });

  describe('removeClient', () => {
    it('should remove an existing client', () => {
      streamHandler.addClient('client-1', mockWebSocket, 'session-123');
      streamHandler.removeClient('client-1');

      expect(streamHandler.getClientCount()).toBe(0);
    });

    it('should handle removing non-existent client', () => {
      streamHandler.removeClient('non-existent');
      expect(streamHandler.getClientCount()).toBe(0);
    });
  });

  describe('broadcastFrame', () => {
    it('should broadcast frame to all connected clients', () => {
      const mockClient1 = { ...mockWebSocket, id: 'client-1' };
      const mockClient2 = { ...mockWebSocket, id: 'client-2', send: vi.fn((_data, cb) => cb?.()) };

      streamHandler.addClient('client-1', mockClient1, 'session-123');
      streamHandler.addClient('client-2', mockClient2, 'session-123');

      const frameData = Buffer.from('video frame data');
      streamHandler.broadcastFrame(frameData);

      expect(mockClient1.send).toHaveBeenCalledWith(frameData, expect.any(Function));
      expect(mockClient2.send).toHaveBeenCalledWith(frameData, expect.any(Function));
    });

    it('should handle send errors gracefully', () => {
      const errorClient = {
        ...mockWebSocket,
        send: vi.fn((_data, callback) => {
          callback?.(new Error('Send failed'));
        }),
      };

      streamHandler.addClient('client-1', errorClient, 'session-123');

      const frameData = Buffer.from('video frame data');
      streamHandler.broadcastFrame(frameData);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send frame'),
        expect.any(Error)
      );
    });

    it('should skip clients not in OPEN state', () => {
      const closedClient = {
        ...mockWebSocket,
        readyState: WebSocket.CLOSED,
      };

      streamHandler.addClient('client-1', closedClient, 'session-123');

      const frameData = Buffer.from('video frame data');
      streamHandler.broadcastFrame(frameData);

      expect(closedClient.send).not.toHaveBeenCalled();
    });

    it('should handle empty frame data', () => {
      streamHandler.addClient('client-1', mockWebSocket, 'session-123');

      const emptyFrame = Buffer.alloc(0);
      streamHandler.broadcastFrame(emptyFrame);

      expect(mockWebSocket.send).toHaveBeenCalledWith(emptyFrame, expect.any(Function));
    });
  });

  describe('stop', () => {
    it('should close all client connections', () => {
      const mockClient1 = { ...mockWebSocket, id: 'client-1' };
      const mockClient2 = { ...mockWebSocket, id: 'client-2', close: vi.fn() };

      streamHandler.addClient('client-1', mockClient1, 'session-123');
      streamHandler.addClient('client-2', mockClient2, 'session-123');

      streamHandler.stop();

      expect(mockClient1.close).toHaveBeenCalled();
      expect(mockClient2.close).toHaveBeenCalled();
      expect(streamHandler.getClientCount()).toBe(0);
    });

    it('should handle errors during client closure', () => {
      const errorClient = {
        ...mockWebSocket,
        close: vi.fn(() => {
          throw new Error('Close failed');
        }),
      };

      streamHandler.addClient('client-1', errorClient, 'session-123');

      // Should not throw
      streamHandler.stop();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error closing client'),
        expect.any(Error)
      );
    });
  });

  describe('getClientCount', () => {
    it('should return correct client count', () => {
      expect(streamHandler.getClientCount()).toBe(0);

      streamHandler.addClient('client-1', mockWebSocket, 'session-123');
      expect(streamHandler.getClientCount()).toBe(1);

      const anotherClient = { ...mockWebSocket, id: 'another-client' };
      streamHandler.addClient('another-client', anotherClient, 'session-123');
      expect(streamHandler.getClientCount()).toBe(2);

      streamHandler.removeClient('client-1');
      expect(streamHandler.getClientCount()).toBe(1);
    });
  });

  describe('concurrent operations', () => {
    it('should handle concurrent client operations safely', () => {
      const clients = Array.from({ length: 10 }, (_, i) => ({
        ...mockWebSocket,
        id: `client-${i}`,
        send: vi.fn((_data, cb) => cb?.()),
      }));

      // Add all clients
      clients.forEach((client, i) => streamHandler.addClient(`client-${i}`, client, 'session-123'));
      expect(streamHandler.getClientCount()).toBe(10);

      // Broadcast to all
      const frameData = Buffer.from('concurrent test');
      streamHandler.broadcastFrame(frameData);

      clients.forEach((client) => {
        expect(client.send).toHaveBeenCalledWith(frameData, expect.any(Function));
      });

      // Remove half the clients
      clients.slice(0, 5).forEach((_, i) => streamHandler.removeClient(`client-${i}`));
      expect(streamHandler.getClientCount()).toBe(5);
    });

    it('should handle client disconnect during broadcast', () => {
      const callbacks: { disconnect?: () => void } = {};
      const disconnectingClient = {
        ...mockWebSocket,
        send: vi.fn((_data, callback) => {
          // Simulate disconnect during send
          if (callbacks.disconnect) {
            callbacks.disconnect();
          }
          callback?.();
        }),
      };

      streamHandler.addClient('client-1', disconnectingClient, 'session-123');

      // Get the close callback
      const disconnectCallback = disconnectingClient.on.mock.calls.find(
        (call: any) => call[0] === 'close'
      )?.[1];

      callbacks.disconnect = disconnectCallback;

      const frameData = Buffer.from('test data');
      streamHandler.broadcastFrame(frameData);

      // Client should have been removed during broadcast
      expect(streamHandler.getClientCount()).toBe(0);
    });
  });
});
