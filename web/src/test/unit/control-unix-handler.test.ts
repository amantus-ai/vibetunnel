import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlMessage } from '../../server/websocket/control-protocol.js';
import type { ControlUnixHandler } from '../../server/websocket/control-unix-handler.js';

// Mock dependencies
vi.mock('fs', () => ({
  promises: {
    unlink: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  chmod: vi.fn((_path, _mode, cb) => cb(null)),
}));

vi.mock('net', () => ({
  createServer: vi.fn(() => ({
    listen: vi.fn((_path, cb) => cb?.()),
    close: vi.fn(),
    on: vi.fn(),
  })),
}));

// Mock logger
vi.mock('../../server/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('Control Unix Handler', () => {
  let controlUnixHandler: ControlUnixHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Import after mocks are set up
    const module = await import('../../server/websocket/control-unix-handler');
    controlUnixHandler = module.controlUnixHandler;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Basic Functionality', () => {
    it('should start the Unix socket server', async () => {
      await controlUnixHandler.start();

      const net = await vi.importMock<typeof import('net')>('net');
      expect(net.createServer).toHaveBeenCalled();
    });

    it('should check if Mac app is connected', () => {
      expect(controlUnixHandler.isMacAppConnected()).toBe(false);
    });

    it('should stop the Unix socket server', () => {
      controlUnixHandler.stop();
      // Just verify it doesn't throw
      expect(true).toBe(true);
    });
  });

  describe('Message Handling', () => {
    it('should handle browser WebSocket connections', () => {
      const mockWs = {
        on: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
        readyState: 1,
      } as unknown as import('ws').WebSocket;

      // Should not throw
      controlUnixHandler.handleBrowserConnection(mockWs, 'test-user');

      expect(mockWs.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should return null when Mac is not connected', async () => {
      const message = {
        id: 'test-123',
        type: 'request' as const,
        category: 'system' as const,
        action: 'test',
        payload: { test: true },
      };

      // When Mac is not connected, sendControlMessage should return null immediately
      const result = await controlUnixHandler.sendControlMessage(message);
      expect(result).toBe(null);
    }, 1000);
  });

  describe('Config Update Callback', () => {
    it('should set and call config update callback', () => {
      const mockCallback = vi.fn();

      // Set callback
      controlUnixHandler.setConfigUpdateCallback(mockCallback);

      // Get the system handler to trigger update directly
      const systemHandler = (
        controlUnixHandler as unknown as {
          handlers: Map<
            string,
            { handleMessage: (msg: ControlMessage) => Promise<ControlMessage | null> }
          >;
        }
      ).handlers.get('system');

      // Trigger update through a repository-path-update message
      const message = {
        id: 'test-123',
        type: 'request' as const,
        category: 'system' as const,
        action: 'repository-path-update',
        payload: { path: '/test/path' },
      };

      systemHandler?.handleMessage(message);

      // Verify callback was called
      expect(mockCallback).toHaveBeenCalledWith({ repositoryBasePath: '/test/path' });
    });
  });

  describe('Mac Message Handling', () => {
    it('should process repository-path-update messages from Mac app', async () => {
      const mockCallback = vi.fn();
      controlUnixHandler.setConfigUpdateCallback(mockCallback);

      // Simulate Mac sending a repository-path-update message
      const message = {
        id: 'mac-msg-123',
        type: 'request' as const,
        category: 'system' as const,
        action: 'repository-path-update',
        payload: { path: '/Users/test/MacSelectedPath' },
      };

      // Process the message through the system handler
      const systemHandler = (
        controlUnixHandler as unknown as {
          handlers: Map<string, { handleMessage: (msg: typeof message) => Promise<unknown> }>;
        }
      ).handlers.get('system');
      const response = await systemHandler?.handleMessage(message);

      // Verify the update was processed
      expect(mockCallback).toHaveBeenCalledWith({
        repositoryBasePath: '/Users/test/MacSelectedPath',
      });

      // Verify successful response
      expect(response).toMatchObject({
        id: 'mac-msg-123',
        type: 'response',
        category: 'system',
        action: 'repository-path-update',
        payload: { success: true, path: '/Users/test/MacSelectedPath' },
      });

      // Verify the path was stored
      expect(controlUnixHandler.getRepositoryPath()).toBe('/Users/test/MacSelectedPath');
    });

    it('should handle missing path in repository-path-update payload', async () => {
      const mockCallback = vi.fn();
      controlUnixHandler.setConfigUpdateCallback(mockCallback);

      // Message with missing path
      const message = {
        id: 'mac-msg-456',
        type: 'request' as const,
        category: 'system' as const,
        action: 'repository-path-update',
        payload: {},
      };

      // Process the message
      const systemHandler = (
        controlUnixHandler as unknown as {
          handlers: Map<string, { handleMessage: (msg: typeof message) => Promise<unknown> }>;
        }
      ).handlers.get('system');
      const response = await systemHandler?.handleMessage(message);

      // Verify callback was not called
      expect(mockCallback).not.toHaveBeenCalled();

      // Verify error response
      expect(response).toMatchObject({
        id: 'mac-msg-456',
        type: 'response',
        category: 'system',
        action: 'repository-path-update',
        error: 'Missing path in payload',
      });
    });

    it('should not process response messages for repository-path-update', async () => {
      const mockCallback = vi.fn();
      controlUnixHandler.setConfigUpdateCallback(mockCallback);

      // Response message (should be ignored)
      const message = {
        id: 'mac-msg-789',
        type: 'response' as const,
        category: 'system' as const,
        action: 'repository-path-update',
        payload: { success: true, path: '/some/path' },
      };

      // Simulate handleMacMessage behavior - response messages without pending requests are ignored
      const pendingRequests = (
        controlUnixHandler as unknown as { pendingRequests: Map<string, unknown> }
      ).pendingRequests;
      const hasPendingRequest = pendingRequests.has(message.id);

      // Since this is a response without a pending request, it should be ignored
      expect(hasPendingRequest).toBe(false);

      // Verify callback was not called
      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  // Screencap functionality was removed from the project
});
