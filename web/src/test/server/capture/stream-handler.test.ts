import { EventEmitter, Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { StreamHandler } from '../../../server/capture/stream-handler.js';
import { createLogger } from '../../../server/utils/logger.js';

// Mock dependencies
vi.mock('../../../server/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('StreamHandler', () => {
  let streamHandler: StreamHandler;
  let mockLogger: ReturnType<typeof createLogger>;
  let mockWebSocket: WebSocket & EventEmitter;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();

    mockLogger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    vi.mocked(createLogger).mockReturnValue(mockLogger);

    streamHandler = new StreamHandler();

    // Create mock WebSocket with EventEmitter capabilities
    mockWebSocket = Object.assign(new EventEmitter(), {
      readyState: 1, // OPEN
      OPEN: 1,
      CONNECTING: 0,
      CLOSING: 2,
      CLOSED: 3,
      send: vi.fn(),
      close: vi.fn(),
      on: vi.fn(function (this: EventEmitter, event: string, listener: (...args: any[]) => void) {
        EventEmitter.prototype.on.call(this, event, listener);
        return this;
      }),
      removeEventListener: vi.fn(),
    }) as WebSocket & EventEmitter;
  });

  describe('addClient', () => {
    it('should add a new WebSocket client', () => {
      streamHandler.addClient('client-1', mockWebSocket, 'session-123');

      expect(mockWebSocket.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockWebSocket.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockWebSocket.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Adding stream client client-1 for session session-123'
      );
    });

    it('should handle client close event', () => {
      streamHandler.addClient('client-1', mockWebSocket, 'session-123');

      // Emit close event
      mockWebSocket.emit('close');

      expect(mockLogger.log).toHaveBeenCalledWith('Removing stream client client-1');
    });

    it('should handle client error event', () => {
      streamHandler.addClient('client-1', mockWebSocket, 'session-123');

      const testError = new Error('Connection error');
      mockWebSocket.emit('error', testError);

      expect(mockLogger.error).toHaveBeenCalledWith('Client client-1 error:', testError);
      expect(mockLogger.log).toHaveBeenCalledWith('Removing stream client client-1');
    });

    it('should handle client messages', () => {
      streamHandler.addClient('client-1', mockWebSocket, 'session-123');

      // Send a ping message
      const messageData = JSON.stringify({ type: 'ping' });
      mockWebSocket.emit('message', Buffer.from(messageData));

      expect(mockWebSocket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"pong"'));
    });

    it('should handle invalid client messages', () => {
      streamHandler.addClient('client-1', mockWebSocket, 'session-123');

      // Send invalid JSON
      mockWebSocket.emit('message', Buffer.from('invalid json'));

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Invalid message from client client-1:',
        expect.any(Error)
      );
    });
  });

  describe('removeClient', () => {
    it('should remove an existing client', () => {
      streamHandler.addClient('client-1', mockWebSocket, 'session-123');
      streamHandler.removeClient('client-1');

      expect(mockLogger.log).toHaveBeenCalledWith('Removing stream client client-1');
      expect(mockWebSocket.close).toHaveBeenCalled();
    });

    it('should handle removing non-existent client', () => {
      // Should not throw
      expect(() => streamHandler.removeClient('non-existent')).not.toThrow();
    });

    it('should emit session-clients-empty when last client is removed', () => {
      const emitSpy = vi.spyOn(streamHandler, 'emit');

      streamHandler.addClient('client-1', mockWebSocket, 'session-123');
      streamHandler.removeClient('client-1');

      expect(emitSpy).toHaveBeenCalledWith('session-clients-empty', 'session-123');
    });
  });

  describe('subscribe/distributeFrame', () => {
    it('should add and call subscribers', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const unsubscribe1 = streamHandler.subscribe('session-123', callback1);
      streamHandler.subscribe('session-123', callback2);

      const testFrame = new ArrayBuffer(100);
      streamHandler.distributeFrame('session-123', testFrame);

      expect(callback1).toHaveBeenCalledWith(testFrame);
      expect(callback2).toHaveBeenCalledWith(testFrame);

      // Test unsubscribe
      unsubscribe1();
      streamHandler.distributeFrame('session-123', testFrame);
      expect(callback1).toHaveBeenCalledTimes(1); // Not called again
      expect(callback2).toHaveBeenCalledTimes(2);
    });

    it('should handle subscriber errors gracefully', () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Subscriber error');
      });
      const goodCallback = vi.fn();

      streamHandler.subscribe('session-123', errorCallback);
      streamHandler.subscribe('session-123', goodCallback);

      const testFrame = new ArrayBuffer(100);
      streamHandler.distributeFrame('session-123', testFrame);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error in stream subscriber callback:',
        expect.any(Error)
      );
      expect(goodCallback).toHaveBeenCalled(); // Other subscribers still called
    });
  });

  describe('streamToSession', () => {
    it('should stream data to session clients', () => {
      const mockStream = new Readable({ read() {} });
      const captureSession = {
        id: 'session-123',
        captureStream: {
          stream: mockStream,
        },
        displayServer: { type: 'x11' },
      };

      streamHandler.addClient('client-1', mockWebSocket, 'session-123');
      streamHandler.streamToSession('session-123', captureSession as any);

      // Should send stream-start message
      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"stream-start"')
      );

      // Emit data
      const testData = Buffer.from('test video data');
      mockStream.emit('data', testData);

      expect(mockWebSocket.send).toHaveBeenCalledWith(testData, { binary: true });
    });

    it('should handle stream end', () => {
      const mockStream = new Readable({ read() {} });
      const captureSession = {
        id: 'session-123',
        captureStream: {
          stream: mockStream,
        },
        displayServer: { type: 'x11' },
      };

      streamHandler.addClient('client-1', mockWebSocket, 'session-123');
      streamHandler.streamToSession('session-123', captureSession as any);

      mockStream.emit('end');

      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"stream-end"')
      );
    });

    it('should handle stream errors', () => {
      const mockStream = new Readable({ read() {} });
      const captureSession = {
        id: 'session-123',
        captureStream: {
          stream: mockStream,
        },
        displayServer: { type: 'x11' },
      };

      streamHandler.addClient('client-1', mockWebSocket, 'session-123');
      streamHandler.streamToSession('session-123', captureSession as any);

      const testError = new Error('Stream error');
      mockStream.emit('error', testError);

      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"stream-error"')
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Stream error for session session-123:',
        testError
      );
    });
  });

  describe('broadcastToSession', () => {
    it('should broadcast message to all session clients', () => {
      const mockWebSocket2 = Object.assign(new EventEmitter(), {
        readyState: 1,
        OPEN: 1,
        send: vi.fn(),
        close: vi.fn(),
        on: vi.fn(function (this: EventEmitter, event: string, listener: (...args: any[]) => void) {
          EventEmitter.prototype.on.call(this, event, listener);
          return this;
        }),
      }) as WebSocket & EventEmitter;

      streamHandler.addClient('client-1', mockWebSocket, 'session-123');
      streamHandler.addClient('client-2', mockWebSocket2, 'session-123');

      const testMessage = { type: 'test', data: 'hello' };
      streamHandler.broadcastToSession('session-123', testMessage);

      expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify(testMessage));
      expect(mockWebSocket2.send).toHaveBeenCalledWith(JSON.stringify(testMessage));
    });
  });

  describe('getSessionClientCount', () => {
    it('should return correct client count', () => {
      expect(streamHandler.getSessionClientCount('session-123')).toBe(0);

      streamHandler.addClient('client-1', mockWebSocket, 'session-123');
      expect(streamHandler.getSessionClientCount('session-123')).toBe(1);

      const mockWebSocket2 = Object.assign(new EventEmitter(), {
        readyState: 1,
        OPEN: 1,
        send: vi.fn(),
        close: vi.fn(),
        on: vi.fn(function (this: EventEmitter, event: string, listener: (...args: any[]) => void) {
          EventEmitter.prototype.on.call(this, event, listener);
          return this;
        }),
      }) as WebSocket & EventEmitter;

      streamHandler.addClient('client-2', mockWebSocket2, 'session-123');
      expect(streamHandler.getSessionClientCount('session-123')).toBe(2);

      streamHandler.removeClient('client-1');
      expect(streamHandler.getSessionClientCount('session-123')).toBe(1);
    });
  });

  describe('cleanupInactiveClients', () => {
    it('should remove inactive clients', () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      streamHandler.addClient('client-1', mockWebSocket, 'session-123');

      // Advance time beyond inactivity threshold
      vi.setSystemTime(now + 70000); // 70 seconds later

      streamHandler.cleanupInactiveClients(60000);

      expect(mockLogger.log).toHaveBeenCalledWith('Removing inactive client client-1');
      expect(mockWebSocket.close).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should keep active clients', () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      streamHandler.addClient('client-1', mockWebSocket, 'session-123');

      // Send a ping to update activity
      vi.setSystemTime(now + 30000); // 30 seconds later
      mockWebSocket.emit('message', Buffer.from(JSON.stringify({ type: 'ping' })));

      // Advance time but not enough to exceed threshold from last activity
      vi.setSystemTime(now + 70000); // 70 seconds from start, 40 seconds from last activity

      streamHandler.cleanupInactiveClients(60000);

      // Client should not be removed
      expect(mockLogger.log).not.toHaveBeenCalledWith('Removing inactive client client-1');

      vi.useRealTimers();
    });
  });

  describe('quality requests', () => {
    it('should emit quality request events', () => {
      const emitSpy = vi.spyOn(streamHandler, 'emit');

      streamHandler.addClient('client-1', mockWebSocket, 'session-123');

      const qualityMessage = JSON.stringify({ type: 'quality', quality: 'high' });
      mockWebSocket.emit('message', Buffer.from(qualityMessage));

      expect(emitSpy).toHaveBeenCalledWith('quality-request', {
        sessionId: 'session-123',
        clientId: 'client-1',
        quality: 'high',
      });
    });
  });
});
