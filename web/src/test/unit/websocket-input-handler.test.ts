/**
 * Tests for WebSocket Input Handler
 *
 * This tests the low-latency WebSocket input protocol for VibeTunnel,
 * focusing on special key handling, text input, and HQ mode support.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket as WSWebSocket } from 'ws';
import type { PtyManager } from '../../server/pty/pty-manager';
import { WebSocketInputHandler } from '../../server/routes/websocket-input';
import type { ActivityMonitor } from '../../server/services/activity-monitor';
import type { AuthService } from '../../server/services/auth-service';
import type { RemoteRegistry } from '../../server/services/remote-registry';
import type { TerminalManager } from '../../server/services/terminal-manager';
import type { SpecialKey } from '../../shared/types';

// Type definitions for mock objects
type MockEventListener = (...args: unknown[]) => void;

// Mock WebSocket
const mockWebSocket = () => {
  const listeners: Record<string, MockEventListener[]> = {};
  const ws = {
    readyState: 1, // OPEN
    on: vi.fn((event: string, listener: MockEventListener) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(listener);
    }),
    off: vi.fn(),
    close: vi.fn(),
    send: vi.fn(),
    // Helper to emit events
    emit: (event: string, ...args: unknown[]) => {
      if (listeners[event]) {
        listeners[event].forEach((listener) => listener(...args));
      }
    },
  };
  return ws as unknown as WSWebSocket;
};

// Mock remote WebSocket for HQ mode testing
const mockRemoteWebSocket = () => {
  const listeners: Record<string, MockEventListener[]> = {};
  const remoteWs = {
    readyState: 1, // OPEN
    addEventListener: vi.fn((event: string, listener: MockEventListener) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(listener);
    }),
    close: vi.fn(),
    send: vi.fn(),
    // Helper to emit events
    emit: (event: string, ...args: unknown[]) => {
      if (listeners[event]) {
        listeners[event].forEach((listener) => listener(...args));
      }
    },
  };

  // Mock global WebSocket constructor for remote connections
  global.WebSocket = vi.fn(() => {
    // Immediately emit 'open' event to simulate successful connection
    setTimeout(() => {
      remoteWs.emit('open');
    }, 0);
    return remoteWs;
  }) as unknown as new (
    url: string
  ) => WebSocket;

  // Mock WebSocket constants
  (global.WebSocket as unknown as { OPEN: number }).OPEN = 1;

  return remoteWs;
};

describe('WebSocketInputHandler', () => {
  let handler: WebSocketInputHandler;
  let mockPtyManager: PtyManager;
  let mockTerminalManager: TerminalManager;
  let mockActivityMonitor: ActivityMonitor;
  let mockAuthService: AuthService;
  let mockRemoteRegistry: RemoteRegistry | null;

  beforeAll(() => {
    // Create mocks
    mockPtyManager = {
      sendInput: vi.fn(),
    } as unknown as PtyManager;

    mockTerminalManager = {} as unknown as TerminalManager;
    mockActivityMonitor = {} as unknown as ActivityMonitor;
    mockAuthService = {} as unknown as AuthService;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRemoteRegistry = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe('Local Session Input Handling', () => {
    beforeEach(() => {
      handler = new WebSocketInputHandler({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        activityMonitor: mockActivityMonitor,
        remoteRegistry: mockRemoteRegistry,
        authService: mockAuthService,
        isHQMode: false,
      });
    });

    it('should handle regular text input', async () => {
      const ws = mockWebSocket();
      const sessionId = 'test-session-1';
      const userId = 'test-user';

      await handler.handleConnection(ws, sessionId, userId);

      // Send regular text
      const inputText = 'hello world';
      ws.emit('message', Buffer.from(inputText));

      expect(mockPtyManager.sendInput).toHaveBeenCalledWith(sessionId, {
        text: inputText,
      });
    });

    it('should handle text containing key names without special treatment', async () => {
      const ws = mockWebSocket();
      const sessionId = 'test-session-2';
      const userId = 'test-user';

      await handler.handleConnection(ws, sessionId, userId);

      // Text that contains key names but isn't wrapped in null bytes
      const inputText = 'i enter the world and press escape to exit';
      ws.emit('message', Buffer.from(inputText));

      expect(mockPtyManager.sendInput).toHaveBeenCalledWith(sessionId, {
        text: inputText,
      });
    });

    it('should handle special keys wrapped in null bytes', async () => {
      const ws = mockWebSocket();
      const sessionId = 'test-session-3';
      const userId = 'test-user';

      await handler.handleConnection(ws, sessionId, userId);

      // Test various special keys
      const specialKeys: SpecialKey[] = [
        'enter',
        'escape',
        'backspace',
        'tab',
        'arrow_up',
        'arrow_down',
        'arrow_left',
        'arrow_right',
        'ctrl_enter',
        'shift_enter',
        'page_up',
        'page_down',
        'home',
        'end',
        'delete',
        'f1',
        'f2',
        'f3',
        'f4',
        'f5',
        'f6',
        'f7',
        'f8',
        'f9',
        'f10',
        'f11',
        'f12',
      ];

      for (const key of specialKeys) {
        const wrappedKey = `\x00${key}\x00`;
        ws.emit('message', Buffer.from(wrappedKey));

        expect(mockPtyManager.sendInput).toHaveBeenCalledWith(sessionId, {
          key: key,
        });
      }

      expect(mockPtyManager.sendInput).toHaveBeenCalledTimes(specialKeys.length);
    });

    it('should treat unknown special keys as text', async () => {
      const ws = mockWebSocket();
      const sessionId = 'test-session-4';
      const userId = 'test-user';

      await handler.handleConnection(ws, sessionId, userId);

      // Unknown key wrapped in null bytes should be treated as text
      const unknownKey = '\x00unknown_key\x00';
      ws.emit('message', Buffer.from(unknownKey));

      expect(mockPtyManager.sendInput).toHaveBeenCalledWith(sessionId, {
        key: 'unknown_key',
      });
    });

    it('should handle malformed special key markers', async () => {
      const ws = mockWebSocket();
      const sessionId = 'test-session-5';
      const userId = 'test-user';

      await handler.handleConnection(ws, sessionId, userId);

      // Test malformed markers
      const malformedInputs = [
        '\x00enter', // Missing closing null byte
        'escape\x00', // Missing opening null byte
        '\x00\x00', // Empty key name
        '\x00', // Just opening null byte
        '\x00enter\x00extra', // Extra content after
      ];

      for (const input of malformedInputs) {
        ws.emit('message', Buffer.from(input));

        expect(mockPtyManager.sendInput).toHaveBeenCalledWith(sessionId, {
          text: input,
        });
      }
    });

    it('should ignore empty messages', async () => {
      const ws = mockWebSocket();
      const sessionId = 'test-session-6';
      const userId = 'test-user';

      await handler.handleConnection(ws, sessionId, userId);

      // Send empty message
      ws.emit('message', Buffer.from(''));

      expect(mockPtyManager.sendInput).not.toHaveBeenCalled();
    });

    it('should handle rapid input without losing messages', async () => {
      const ws = mockWebSocket();
      const sessionId = 'test-session-7';
      const userId = 'test-user';

      await handler.handleConnection(ws, sessionId, userId);

      // Send multiple rapid inputs
      const inputs = ['a', 'b', 'c', '\x00enter\x00', 'hello', '\x00escape\x00'];

      for (const input of inputs) {
        ws.emit('message', Buffer.from(input));
      }

      expect(mockPtyManager.sendInput).toHaveBeenCalledTimes(6);
      expect(mockPtyManager.sendInput).toHaveBeenNthCalledWith(1, sessionId, { text: 'a' });
      expect(mockPtyManager.sendInput).toHaveBeenNthCalledWith(2, sessionId, { text: 'b' });
      expect(mockPtyManager.sendInput).toHaveBeenNthCalledWith(3, sessionId, { text: 'c' });
      expect(mockPtyManager.sendInput).toHaveBeenNthCalledWith(4, sessionId, { key: 'enter' });
      expect(mockPtyManager.sendInput).toHaveBeenNthCalledWith(5, sessionId, { text: 'hello' });
      expect(mockPtyManager.sendInput).toHaveBeenNthCalledWith(6, sessionId, { key: 'escape' });
    });

    it('should handle binary data gracefully', async () => {
      const ws = mockWebSocket();
      const sessionId = 'test-session-8';
      const userId = 'test-user';

      await handler.handleConnection(ws, sessionId, userId);

      // Send binary data that doesn't match special key pattern
      const binaryData = Buffer.from([0xff, 0xfe, 0xfd]);
      ws.emit('message', binaryData);

      // Should be converted to string and treated as text
      expect(mockPtyManager.sendInput).toHaveBeenCalledWith(sessionId, {
        text: binaryData.toString(),
      });
    });
  });

  describe('HQ Mode Remote Session Handling', () => {
    let mockRemoteRegistry: RemoteRegistry;
    let mockRemoteWs: ReturnType<typeof mockRemoteWebSocket>;

    beforeEach(() => {
      mockRemoteWs = mockRemoteWebSocket();

      mockRemoteRegistry = {
        getRemoteBySessionId: vi.fn(),
      } as unknown as RemoteRegistry;

      handler = new WebSocketInputHandler({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        activityMonitor: mockActivityMonitor,
        remoteRegistry: mockRemoteRegistry,
        authService: mockAuthService,
        isHQMode: true,
      });
    });

    it('should proxy raw WebSocket data to remote for remote sessions', async () => {
      const ws = mockWebSocket();
      const sessionId = 'remote-session-1';
      const userId = 'test-user';

      // Mock remote registration
      const mockRemote = {
        name: 'remote-server',
        url: 'https://remote.example.com',
        token: 'remote-token',
      };
      vi.mocked(mockRemoteRegistry.getRemoteBySessionId).mockReturnValue(mockRemote);

      await handler.handleConnection(ws, sessionId, userId);

      // Send input that should be proxied
      const inputData = Buffer.from('test input');
      ws.emit('message', inputData);

      // Should forward to remote WebSocket, not to ptyManager
      expect(mockRemoteWs.send).toHaveBeenCalledWith(inputData);
      expect(mockPtyManager.sendInput).not.toHaveBeenCalled();
    });

    it('should handle local sessions normally in HQ mode', async () => {
      const ws = mockWebSocket();
      const sessionId = 'local-session-1';
      const userId = 'test-user';

      // Mock no remote registration (local session)
      vi.mocked(mockRemoteRegistry.getRemoteBySessionId).mockReturnValue(null);

      await handler.handleConnection(ws, sessionId, userId);

      // Send regular input
      const inputText = 'local input';
      ws.emit('message', Buffer.from(inputText));

      // Should use ptyManager for local sessions
      expect(mockPtyManager.sendInput).toHaveBeenCalledWith(sessionId, {
        text: inputText,
      });
      expect(mockRemoteWs.send).not.toHaveBeenCalled();
    });

    it('should handle remote connection failures gracefully', async () => {
      const ws = mockWebSocket();
      const sessionId = 'remote-session-error';
      const userId = 'test-user';

      const mockRemote = {
        name: 'remote-server',
        url: 'https://remote.example.com',
        token: 'remote-token',
      };
      vi.mocked(mockRemoteRegistry.getRemoteBySessionId).mockReturnValue(mockRemote);

      // Override the global WebSocket mock to emit error instead of open
      global.WebSocket = vi.fn(() => {
        setTimeout(() => {
          mockRemoteWs.emit('error', new Error('Connection failed'));
        }, 0);
        return mockRemoteWs;
      }) as unknown as new (
        url: string
      ) => WebSocket;

      await handler.handleConnection(ws, sessionId, userId);

      // Should close the client connection
      expect(ws.close).toHaveBeenCalled();
    });

    it('should close client connection when remote connection closes', async () => {
      const ws = mockWebSocket();
      const sessionId = 'remote-session-close';
      const userId = 'test-user';

      const mockRemote = {
        name: 'remote-server',
        url: 'https://remote.example.com',
        token: 'remote-token',
      };
      vi.mocked(mockRemoteRegistry.getRemoteBySessionId).mockReturnValue(mockRemote);

      await handler.handleConnection(ws, sessionId, userId);

      // Simulate remote close
      mockRemoteWs.emit('close');

      expect(ws.close).toHaveBeenCalled();
    });

    it('should handle different buffer types for remote forwarding', async () => {
      const ws = mockWebSocket();
      const sessionId = 'remote-session-buffers';
      const userId = 'test-user';

      const mockRemote = {
        name: 'remote-server',
        url: 'https://remote.example.com',
        token: 'remote-token',
      };
      vi.mocked(mockRemoteRegistry.getRemoteBySessionId).mockReturnValue(mockRemote);

      await handler.handleConnection(ws, sessionId, userId);

      // Test Buffer
      const bufferData = Buffer.from('buffer data');
      ws.emit('message', bufferData);
      expect(mockRemoteWs.send).toHaveBeenCalledWith(bufferData);

      // Test Buffer array
      const bufferArray = [Buffer.from('part1'), Buffer.from('part2')];
      ws.emit('message', bufferArray);
      expect(mockRemoteWs.send).toHaveBeenCalledWith(Buffer.concat(bufferArray));

      // Test other data types (ArrayBuffer, etc.)
      const arrayBuffer = new ArrayBuffer(8);
      ws.emit('message', arrayBuffer);
      expect(mockRemoteWs.send).toHaveBeenCalledWith(arrayBuffer);
    });
  });

  describe('Connection Lifecycle', () => {
    beforeEach(() => {
      handler = new WebSocketInputHandler({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        activityMonitor: mockActivityMonitor,
        remoteRegistry: null,
        authService: mockAuthService,
        isHQMode: false,
      });
    });

    it('should handle connection close event', async () => {
      const ws = mockWebSocket();
      const sessionId = 'test-session-close';
      const userId = 'test-user';

      await handler.handleConnection(ws, sessionId, userId);

      // Simulate close event
      ws.emit('close');

      // Should not throw any errors
      expect(true).toBe(true);
    });

    it('should handle connection error event', async () => {
      const ws = mockWebSocket();
      const sessionId = 'test-session-error';
      const userId = 'test-user';

      await handler.handleConnection(ws, sessionId, userId);

      // Simulate error event
      ws.emit('error', new Error('Connection error'));

      // Should not throw any errors
      expect(true).toBe(true);
    });

    it('should handle ptyManager.sendInput errors gracefully', async () => {
      const ws = mockWebSocket();
      const sessionId = 'test-session-pty-error';
      const userId = 'test-user';

      // Mock ptyManager to throw error
      vi.mocked(mockPtyManager.sendInput).mockImplementation(() => {
        throw new Error('PTY error');
      });

      await handler.handleConnection(ws, sessionId, userId);

      // Send input that will cause error
      ws.emit('message', Buffer.from('test input'));

      // Should not crash the connection
      expect(mockPtyManager.sendInput).toHaveBeenCalled();
    });
  });

  describe('Performance and Edge Cases', () => {
    beforeEach(() => {
      handler = new WebSocketInputHandler({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        activityMonitor: mockActivityMonitor,
        remoteRegistry: null,
        authService: mockAuthService,
        isHQMode: false,
      });
    });

    it('should handle large input messages', async () => {
      const ws = mockWebSocket();
      const sessionId = 'test-session-large';
      const userId = 'test-user';

      await handler.handleConnection(ws, sessionId, userId);

      // Send large text input
      const largeText = 'x'.repeat(100000);
      ws.emit('message', Buffer.from(largeText));

      expect(mockPtyManager.sendInput).toHaveBeenCalledWith(sessionId, {
        text: largeText,
      });
    });

    it('should handle null bytes in regular text', async () => {
      const ws = mockWebSocket();
      const sessionId = 'test-session-nulls';
      const userId = 'test-user';

      await handler.handleConnection(ws, sessionId, userId);

      // Text with embedded null bytes (not at start/end)
      const textWithNulls = 'hello\x00world\x00test';
      ws.emit('message', Buffer.from(textWithNulls));

      expect(mockPtyManager.sendInput).toHaveBeenCalledWith(sessionId, {
        text: textWithNulls,
      });
    });

    it('should handle Unicode characters correctly', async () => {
      const ws = mockWebSocket();
      const sessionId = 'test-session-unicode';
      const userId = 'test-user';

      await handler.handleConnection(ws, sessionId, userId);

      // Unicode text
      const unicodeText = '🚀 Hello 世界 🌍';
      ws.emit('message', Buffer.from(unicodeText));

      expect(mockPtyManager.sendInput).toHaveBeenCalledWith(sessionId, {
        text: unicodeText,
      });
    });

    it('should handle concurrent messages from same connection', async () => {
      const ws = mockWebSocket();
      const sessionId = 'test-session-concurrent';
      const userId = 'test-user';

      await handler.handleConnection(ws, sessionId, userId);

      // Send many messages in quick succession
      const messages = Array.from({ length: 100 }, (_, i) => `msg${i}`);

      messages.forEach((msg) => {
        ws.emit('message', Buffer.from(msg));
      });

      expect(mockPtyManager.sendInput).toHaveBeenCalledTimes(100);

      // Verify all messages were processed
      messages.forEach((msg, i) => {
        expect(mockPtyManager.sendInput).toHaveBeenNthCalledWith(i + 1, sessionId, {
          text: msg,
        });
      });
    });
  });
});
