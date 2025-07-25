// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferSubscriptionService } from '../../client/services/buffer-subscription-service';
import type { MockWebSocketConstructor } from '../types/test-types';

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  binaryType: string = 'blob';
  readyState: number = MockWebSocket.CONNECTING;

  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Simulate connection immediately
    this.readyState = MockWebSocket.OPEN;
    // Trigger onopen asynchronously
    Promise.resolve().then(() => {
      this.onopen?.(new Event('open'));
    });
  }

  send(_data: string | ArrayBuffer) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }
}

// Store mock function reference for tests
const mockDecodeBinaryBuffer = vi.fn().mockReturnValue({
  cols: 80,
  rows: 24,
  viewportY: 0,
  cursorX: 0,
  cursorY: 0,
  cells: [],
});

// Mock dynamic import of terminal-renderer
vi.doMock('../../client/utils/terminal-renderer.js', () => {
  return {
    default: {},
    TerminalRenderer: {
      decodeBinaryBuffer: mockDecodeBinaryBuffer,
    },
  };
});

describe('BufferSubscriptionService', () => {
  let service: BufferSubscriptionService;
  let mockWebSocket: MockWebSocket;
  let sentMessages: string[] = [];

  beforeEach(async () => {
    vi.useFakeTimers();
    // Reset sent messages
    sentMessages = [];

    // Mock fetch for auth config
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/auth/config') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ noAuth: true }),
        });
      }
      return Promise.reject(new Error('Not found'));
    }) as unknown as typeof fetch;

    // Replace global WebSocket with our mock
    global.WebSocket = vi.fn().mockImplementation((url: string) => {
      mockWebSocket = new MockWebSocket(url);

      // Capture sent messages
      const originalSend = mockWebSocket.send.bind(mockWebSocket);
      mockWebSocket.send = (data: string | ArrayBuffer) => {
        if (typeof data === 'string') {
          sentMessages.push(data);
        }
        originalSend(data);
      };

      return mockWebSocket;
    }) as unknown as MockWebSocketConstructor;

    // Add WebSocket constants to global
    const ws = global.WebSocket as MockWebSocketConstructor;
    ws.CONNECTING = MockWebSocket.CONNECTING;
    ws.OPEN = MockWebSocket.OPEN;
    ws.CLOSING = MockWebSocket.CLOSING;
    ws.CLOSED = MockWebSocket.CLOSED;

    // Mock window.location
    Object.defineProperty(window, 'location', {
      value: { host: 'localhost:8080', protocol: 'http:' },
      writable: true,
    });

    // Create service
    service = new BufferSubscriptionService();

    // Initialize the service to trigger connection
    await service.initialize();

    // Advance only the initialize timeout (100ms)
    await vi.advanceTimersByTimeAsync(100);

    // Wait for the WebSocket connection promise
    await vi.waitFor(() => {
      return mockWebSocket && mockWebSocket.readyState === MockWebSocket.OPEN;
    });
  });

  afterEach(() => {
    service.dispose();
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('Connection Management', () => {
    it('should connect to WebSocket on creation', () => {
      expect(global.WebSocket).toHaveBeenCalledWith('ws://localhost:8080/buffers');
      expect(mockWebSocket.readyState).toBe(MockWebSocket.OPEN);
    });

    it('should use wss for https', async () => {
      service.dispose();

      window.location.protocol = 'https:';
      service = new BufferSubscriptionService();
      await service.initialize();
      await vi.advanceTimersByTimeAsync(100);

      expect(global.WebSocket).toHaveBeenCalledWith('wss://localhost:8080/buffers');
    });

    it('should set binary type to arraybuffer', () => {
      expect(mockWebSocket.binaryType).toBe('arraybuffer');
    });

    it('should handle connection errors', async () => {
      service.dispose();

      // Make WebSocket constructor throw
      global.WebSocket = vi.fn().mockImplementation(() => {
        throw new Error('Connection failed');
      }) as unknown as typeof WebSocket;

      // Should not throw
      service = new BufferSubscriptionService();
      await expect(service.initialize()).resolves.not.toThrow();
    });

    it('should reconnect on disconnect', async () => {
      // Reset call count
      vi.clearAllMocks();

      // Force disconnect
      mockWebSocket.close();

      // Advance timer for reconnect attempt (1000ms)
      await vi.advanceTimersByTimeAsync(1100);

      // Should have attempted to reconnect
      expect(global.WebSocket).toHaveBeenCalledTimes(1);
    });

    it('should use exponential backoff for reconnection', async () => {
      // First disconnect
      mockWebSocket.close();

      // Advance timer by first delay (1000ms)
      vi.advanceTimersByTime(1000);

      // Second disconnect
      mockWebSocket?.close();

      // Should use doubled delay (2000ms)
      vi.advanceTimersByTime(1999);
      expect(global.WebSocket).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(1);
      expect(global.WebSocket).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });
  });

  describe('Subscriptions', () => {
    it('should subscribe to session', () => {
      const handler = vi.fn();
      service.subscribe('session123', handler);

      expect(sentMessages).toContainEqual(
        JSON.stringify({ type: 'subscribe', sessionId: 'session123' })
      );
    });

    it('should not send duplicate subscribe messages', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      service.subscribe('session123', handler1);
      service.subscribe('session123', handler2);

      const subscribeMessages = sentMessages.filter(
        (msg) => JSON.parse(msg).type === 'subscribe' && JSON.parse(msg).sessionId === 'session123'
      );

      expect(subscribeMessages).toHaveLength(1);
    });

    it('should unsubscribe when last handler removed', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const unsubscribe1 = service.subscribe('session123', handler1);
      const unsubscribe2 = service.subscribe('session123', handler2);

      // Remove first handler - should not unsubscribe
      unsubscribe1();

      const unsubscribeMessages1 = sentMessages.filter(
        (msg) => JSON.parse(msg).type === 'unsubscribe'
      );
      expect(unsubscribeMessages1).toHaveLength(0);

      // Remove second handler - should unsubscribe
      unsubscribe2();

      const unsubscribeMessages2 = sentMessages.filter(
        (msg) => JSON.parse(msg).type === 'unsubscribe'
      );
      expect(unsubscribeMessages2).toHaveLength(1);
      expect(unsubscribeMessages2[0]).toBe(
        JSON.stringify({ type: 'unsubscribe', sessionId: 'session123' })
      );
    });

    it('should resubscribe after reconnection', async () => {
      const handler = vi.fn();
      service.subscribe('session123', handler);

      // Clear sent messages
      sentMessages = [];

      // Force disconnect and reconnect
      mockWebSocket.close();

      // Advance timer for reconnection
      await vi.advanceTimersByTimeAsync(1100);

      // Should have resubscribed
      expect(sentMessages).toContainEqual(
        JSON.stringify({ type: 'subscribe', sessionId: 'session123' })
      );
    });
  });

  describe('Message Handling', () => {
    it('should handle binary buffer updates', async () => {
      const handler = vi.fn();
      service.subscribe('test123', handler);

      // Create binary message
      const sessionId = 'test123';
      const sessionIdBytes = new TextEncoder().encode(sessionId);
      const bufferData = new ArrayBuffer(32); // Minimal buffer data

      const message = new ArrayBuffer(1 + 4 + sessionIdBytes.length + bufferData.byteLength);
      const view = new DataView(message);

      // Magic byte
      view.setUint8(0, 0xbf);
      // Session ID length
      view.setUint32(1, sessionIdBytes.length, true);
      // Session ID
      new Uint8Array(message, 5, sessionIdBytes.length).set(sessionIdBytes);
      // Buffer data
      new Uint8Array(message, 5 + sessionIdBytes.length).set(new Uint8Array(bufferData));

      // Send message
      mockWebSocket.onmessage?.(new MessageEvent('message', { data: message }));

      // Wait for dynamic import and message processing
      // Use real timers briefly to allow the promise to resolve
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 10));
      vi.useFakeTimers();

      // Wait for handler to be called
      await vi.waitFor(() => handler.mock.calls.length > 0, { timeout: 100 });

      expect(handler).toHaveBeenCalledWith({
        cols: 80,
        rows: 24,
        viewportY: 0,
        cursorX: 0,
        cursorY: 0,
        cells: [],
      });
    });

    it('should handle JSON messages', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Send connected message
      mockWebSocket.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'connected', version: '1.0.0' }),
        })
      );

      // Send ping message
      mockWebSocket.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'ping' }),
        })
      );

      expect(sentMessages).toContainEqual(JSON.stringify({ type: 'pong' }));

      consoleSpy.mockRestore();
    });

    it('should handle error messages', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockWebSocket.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'error', message: 'Test error' }),
        })
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        '[buffer-subscription-service]',
        'server error: Test error'
      );

      consoleSpy.mockRestore();
    });

    it('should ignore messages for unsubscribed sessions', async () => {
      const handler = vi.fn();

      // Create binary message for non-subscribed session
      const sessionId = 'unsubscribed';
      const sessionIdBytes = new TextEncoder().encode(sessionId);
      const message = new ArrayBuffer(1 + 4 + sessionIdBytes.length + 32);
      const view = new DataView(message);

      view.setUint8(0, 0xbf);
      view.setUint32(1, sessionIdBytes.length, true);
      new Uint8Array(message, 5, sessionIdBytes.length).set(sessionIdBytes);

      mockWebSocket.onmessage?.(new MessageEvent('message', { data: message }));

      // Wait for dynamic import and message processing
      // Use real timers briefly to allow the promise to resolve
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 10));
      vi.useFakeTimers();

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle invalid binary messages', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Send message with wrong magic byte
      const message = new ArrayBuffer(1);
      new DataView(message).setUint8(0, 0xff);

      mockWebSocket.onmessage?.(new MessageEvent('message', { data: message }));

      expect(consoleSpy).toHaveBeenCalledWith(
        '[buffer-subscription-service]',
        'invalid magic byte: 255'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Message Queuing', () => {
    it('should queue messages when disconnected', () => {
      // Close connection
      mockWebSocket.readyState = MockWebSocket.CLOSED;

      const handler = vi.fn();
      service.subscribe('session123', handler);

      // Should not have sent message yet
      const subscribeMessages = sentMessages.filter(
        (msg) => JSON.parse(msg).sessionId === 'session123'
      );
      expect(subscribeMessages).toHaveLength(0);
    });

    it('should send queued messages on reconnect', async () => {
      // Subscribe while connected
      const handler = vi.fn();
      service.subscribe('session456', handler);

      // Disconnect
      mockWebSocket.close();

      // Try to subscribe while disconnected
      service.subscribe('session789', vi.fn());

      // Wait for reconnect
      await vi.advanceTimersByTimeAsync(1100);

      // Should have sent both subscriptions
      expect(sentMessages).toContainEqual(
        JSON.stringify({ type: 'subscribe', sessionId: 'session456' })
      );
      expect(sentMessages).toContainEqual(
        JSON.stringify({ type: 'subscribe', sessionId: 'session789' })
      );
    });
  });

  describe('Multiple Handlers', () => {
    it('should notify all handlers for a session', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      service.subscribe('test123', handler1);
      service.subscribe('test123', handler2);

      // Send buffer update
      const sessionId = 'test123';
      const sessionIdBytes = new TextEncoder().encode(sessionId);
      const message = new ArrayBuffer(1 + 4 + sessionIdBytes.length + 32);
      const view = new DataView(message);

      view.setUint8(0, 0xbf);
      view.setUint32(1, sessionIdBytes.length, true);
      new Uint8Array(message, 5, sessionIdBytes.length).set(sessionIdBytes);

      mockWebSocket.onmessage?.(new MessageEvent('message', { data: message }));

      // Wait for dynamic import and message processing
      // Use real timers briefly to allow the promise to resolve
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 10));
      vi.useFakeTimers();

      // Wait for handlers to be called
      await vi.waitFor(() => handler1.mock.calls.length > 0 && handler2.mock.calls.length > 0, {
        timeout: 100,
      });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should handle handler errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const errorHandler = vi.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      const goodHandler = vi.fn();

      service.subscribe('test123', errorHandler);
      service.subscribe('test123', goodHandler);

      // Send buffer update
      const sessionId = 'test123';
      const sessionIdBytes = new TextEncoder().encode(sessionId);
      const message = new ArrayBuffer(1 + 4 + sessionIdBytes.length + 32);
      const view = new DataView(message);

      view.setUint8(0, 0xbf);
      view.setUint32(1, sessionIdBytes.length, true);
      new Uint8Array(message, 5, sessionIdBytes.length).set(sessionIdBytes);

      mockWebSocket.onmessage?.(new MessageEvent('message', { data: message }));

      // Wait for dynamic import and message processing
      // Use real timers briefly to allow the promise to resolve
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 10));
      vi.useFakeTimers();

      // Wait for handlers to be called
      await vi.waitFor(
        () => errorHandler.mock.calls.length > 0 && goodHandler.mock.calls.length > 0,
        { timeout: 100 }
      );

      // Both handlers should have been called
      expect(errorHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('Cleanup', () => {
    it('should clean up on dispose', () => {
      const handler = vi.fn();
      service.subscribe('session123', handler);

      service.dispose();

      expect(mockWebSocket.readyState).toBe(MockWebSocket.CLOSED);
    });

    it('should clear all subscriptions on dispose', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      service.subscribe('session1', handler1);
      service.subscribe('session2', handler2);

      // Verify we have subscribe messages
      expect(sentMessages).toHaveLength(2);

      service.dispose();

      // Clear sent messages to test new service
      sentMessages = [];

      // Create new service
      service = new BufferSubscriptionService();
      await service.initialize();
      await vi.advanceTimersByTimeAsync(100);

      // Should not have any subscription messages from the new service
      expect(sentMessages).toHaveLength(0);
    });

    it('should cancel reconnect timer on dispose', async () => {
      // Force disconnect
      mockWebSocket.close();

      // Dispose before reconnect
      service.dispose();

      // Advance time
      vi.advanceTimersByTime(5000);

      // Should not have reconnected
      expect(global.WebSocket).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });
});
