import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BufferSubscriptionService } from './buffer-subscription-service';
import { MockWebSocket } from '../../test/utils/lit-test-utils';
import { mockBinaryBuffer } from '../../test/fixtures/test-data';
import type { BufferSnapshot } from '../utils/terminal-renderer';

// Mock the terminal renderer module
vi.mock('../utils/terminal-renderer.js', () => ({
  TerminalRenderer: {
    decodeBinaryBuffer: vi.fn(
      (data: ArrayBuffer): BufferSnapshot => ({
        cols: 80,
        rows: 24,
        viewportY: 0,
        cursorX: 2,
        cursorY: 0,
        cells: [],
      })
    ),
  },
}));

// Mock the logger
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    log: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('BufferSubscriptionService', () => {
  let service: BufferSubscriptionService;
  let mockWebSocketConstructor: typeof MockWebSocket;
  let mockWebSocketInstance: MockWebSocket;

  beforeEach(() => {
    vi.useFakeTimers();

    // Create a mock WebSocket instance
    mockWebSocketInstance = new MockWebSocket('ws://localhost/buffers');

    // Mock WebSocket constructor
    mockWebSocketConstructor = vi.fn(() => mockWebSocketInstance) as any;
    mockWebSocketConstructor.CONNECTING = 0;
    mockWebSocketConstructor.OPEN = 1;
    mockWebSocketConstructor.CLOSING = 2;
    mockWebSocketConstructor.CLOSED = 3;

    global.WebSocket = mockWebSocketConstructor as any;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    if (service) {
      service.dispose();
    }
  });

  describe('connection management', () => {
    it('should connect to WebSocket on initialization', () => {
      service = new BufferSubscriptionService();

      expect(mockWebSocketConstructor).toHaveBeenCalledWith('ws://localhost/buffers');
      expect(mockWebSocketInstance.binaryType).toBe('arraybuffer');
    });

    it('should handle successful connection', () => {
      service = new BufferSubscriptionService();

      // Simulate successful connection
      mockWebSocketInstance.mockOpen();

      expect(mockWebSocketInstance.readyState).toBe(WebSocket.OPEN);
    });

    it('should handle connection errors', () => {
      service = new BufferSubscriptionService();

      // Simulate connection error
      mockWebSocketInstance.mockError();

      // Should schedule reconnect
      expect(setTimeout).toHaveBeenCalled();
    });

    it('should reconnect with exponential backoff', () => {
      service = new BufferSubscriptionService();

      // First reconnect - 1 second
      mockWebSocketInstance.mockClose();
      expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 1000);

      // Advance time and trigger reconnect
      vi.advanceTimersByTime(1000);

      // Second reconnect - 2 seconds
      mockWebSocketInstance.mockClose();
      expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 2000);

      // Third reconnect - 4 seconds
      vi.advanceTimersByTime(2000);
      mockWebSocketInstance.mockClose();
      expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 4000);
    });

    it('should cap reconnect delay at 30 seconds', () => {
      service = new BufferSubscriptionService();

      // Trigger many failed connections
      for (let i = 0; i < 10; i++) {
        mockWebSocketInstance.mockClose();
        vi.advanceTimersByTime(30000);
      }

      // Should still be capped at 30 seconds
      expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 30000);
    });
  });

  describe('subscription management', () => {
    beforeEach(() => {
      service = new BufferSubscriptionService();
      mockWebSocketInstance.mockOpen();
    });

    it('should subscribe to a session', () => {
      const handler = vi.fn();
      const unsubscribe = service.subscribe('session-123', handler);

      expect(mockWebSocketInstance.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'subscribe', sessionId: 'session-123' })
      );

      expect(typeof unsubscribe).toBe('function');
    });

    it('should not send duplicate subscribe messages for same session', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      service.subscribe('session-123', handler1);
      service.subscribe('session-123', handler2);

      // Should only send one subscribe message
      expect(mockWebSocketInstance.send).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe when last handler is removed', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const unsubscribe1 = service.subscribe('session-123', handler1);
      const unsubscribe2 = service.subscribe('session-123', handler2);

      // Remove first handler - should not unsubscribe yet
      unsubscribe1();
      expect(mockWebSocketInstance.send).not.toHaveBeenCalledWith(
        JSON.stringify({ type: 'unsubscribe', sessionId: 'session-123' })
      );

      // Remove second handler - should unsubscribe
      unsubscribe2();
      expect(mockWebSocketInstance.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'unsubscribe', sessionId: 'session-123' })
      );
    });

    it('should queue subscribe messages when disconnected', () => {
      const handler = vi.fn();

      // Close connection
      mockWebSocketInstance.mockClose();

      // Try to subscribe while disconnected
      service.subscribe('session-123', handler);

      // Should not send message immediately
      expect(mockWebSocketInstance.send).not.toHaveBeenCalled();

      // Reconnect
      vi.advanceTimersByTime(1000);
      mockWebSocketInstance = new MockWebSocket('ws://localhost/buffers');
      (global.WebSocket as any).mockReturnValue(mockWebSocketInstance);
      mockWebSocketInstance.mockOpen();

      // Should send queued subscribe message
      expect(mockWebSocketInstance.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'subscribe', sessionId: 'session-123' })
      );
    });
  });

  describe('message handling', () => {
    beforeEach(() => {
      service = new BufferSubscriptionService();
      mockWebSocketInstance.mockOpen();
    });

    it('should handle ping messages', () => {
      mockWebSocketInstance.mockMessage(JSON.stringify({ type: 'ping' }));

      expect(mockWebSocketInstance.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong' }));
    });

    it('should handle connected messages', () => {
      mockWebSocketInstance.mockMessage(
        JSON.stringify({
          type: 'connected',
          version: '1.0.0',
        })
      );

      // Should log the connection (mocked logger)
    });

    it('should handle error messages', () => {
      mockWebSocketInstance.mockMessage(
        JSON.stringify({
          type: 'error',
          message: 'Session not found',
        })
      );

      // Should log the error (mocked logger)
    });

    it('should handle binary buffer updates', async () => {
      const handler = vi.fn();
      service.subscribe('session-123', handler);

      // Create a mock binary message
      const sessionId = 'session-123';
      const sessionIdBytes = new TextEncoder().encode(sessionId);
      const totalLength = 1 + 4 + sessionIdBytes.length + mockBinaryBuffer.length;
      const message = new ArrayBuffer(totalLength);
      const view = new DataView(message);
      const uint8View = new Uint8Array(message);

      // Magic byte
      view.setUint8(0, 0xbf);

      // Session ID length
      view.setUint32(1, sessionIdBytes.length, true);

      // Session ID
      uint8View.set(sessionIdBytes, 5);

      // Buffer data
      uint8View.set(mockBinaryBuffer, 5 + sessionIdBytes.length);

      // Send binary message
      mockWebSocketInstance.mockMessage(message);

      // Wait for dynamic import
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalled();
      });

      // Handler should receive decoded buffer
      expect(handler).toHaveBeenCalledWith({
        cols: 80,
        rows: 24,
        viewportY: 0,
        cursorX: 2,
        cursorY: 0,
        cells: [],
      });
    });

    it('should ignore binary messages with invalid magic byte', async () => {
      const handler = vi.fn();
      service.subscribe('session-123', handler);

      // Create message with wrong magic byte
      const message = new ArrayBuffer(10);
      const view = new DataView(message);
      view.setUint8(0, 0xff); // Wrong magic byte

      mockWebSocketInstance.mockMessage(message);

      // Give time for any async operations
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Handler should not be called
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should clean up resources on dispose', () => {
      service = new BufferSubscriptionService();
      mockWebSocketInstance.mockOpen();

      const handler = vi.fn();
      service.subscribe('session-123', handler);

      service.dispose();

      expect(mockWebSocketInstance.close).toHaveBeenCalled();
      expect(clearTimeout).toHaveBeenCalled();
    });

    it('should clear all subscriptions on dispose', () => {
      service = new BufferSubscriptionService();
      mockWebSocketInstance.mockOpen();

      const handler1 = vi.fn();
      const handler2 = vi.fn();

      service.subscribe('session-1', handler1);
      service.subscribe('session-2', handler2);

      service.dispose();

      // Try to send a message after dispose - handlers should not be called
      const message = new ArrayBuffer(100);
      mockWebSocketInstance.mockMessage(message);

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });
});
