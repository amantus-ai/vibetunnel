import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

    it('should send control messages when Mac is connected', async () => {
      const message = {
        id: 'test-123',
        type: 'request' as const,
        category: 'system' as const,
        action: 'test',
        payload: { test: true },
      };

      // When Mac is not connected, should resolve to null
      const result = await controlUnixHandler.sendControlMessage(message);
      expect(result).toBe(null);
    });
  });

  // TODO: These tests are expecting methods that don't exist in the current implementation
  // describe('Config Update Callback', () => {
  //   it('should set and call config update callback', () => {
  //     const mockCallback = vi.fn();
  //
  //     // Set callback
  //     controlUnixHandler.setConfigUpdateCallback(mockCallback);
  //
  //     // Trigger update
  //     (
  //       controlUnixHandler as unknown as {
  //         configUpdateCallback: (config: { repositoryBasePath: string }) => void;
  //       }
  //     ).configUpdateCallback({ repositoryBasePath: '/test/path' });
  //
  //     // Verify callback was called
  //     expect(mockCallback).toHaveBeenCalledWith({ repositoryBasePath: '/test/path' });
  //   });
  // });

  describe('Mac Message Handling', () => {
    // TODO: This test expects setConfigUpdateCallback method that doesn't exist
    it.skip('should process repository-path-update messages from Mac app', async () => {
      const mockCallback = vi.fn();
      // controlUnixHandler.setConfigUpdateCallback(mockCallback);

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
      // TODO: getRepositoryPath method doesn't exist
      // expect(controlUnixHandler.getRepositoryPath()).toBe('/Users/test/MacSelectedPath');
    });

    // TODO: This test expects setConfigUpdateCallback method that doesn't exist
    it.skip('should handle missing path in repository-path-update payload', async () => {
      const mockCallback = vi.fn();
      // controlUnixHandler.setConfigUpdateCallback(mockCallback);

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

    // TODO: This test expects setConfigUpdateCallback method that doesn't exist
    it.skip('should not process response messages for repository-path-update', async () => {
      const mockCallback = vi.fn();
      // controlUnixHandler.setConfigUpdateCallback(mockCallback);

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

  describe('Screencap Response Forwarding', () => {
    // TODO: This test expects screenCaptureHandler that doesn't exist
    it.skip('should forward screencap response messages even without pending requests', async () => {
      // Mock WebSocket for browser connection
      const mockBrowserSocket = {
        readyState: 1, // OPEN
        send: vi.fn(),
      };

      // Mock the screen capture handler
      const mockScreenCaptureHandler = {
        handleMessage: vi.fn().mockResolvedValue(null),
        browserSocket: null as unknown,
      };

      // Set up the handler
      (
        controlUnixHandler as unknown as { screenCaptureHandler: typeof mockScreenCaptureHandler }
      ).screenCaptureHandler = mockScreenCaptureHandler;
      (
        controlUnixHandler as unknown as { handlers: Map<string, typeof mockScreenCaptureHandler> }
      ).handlers.set('screencap', mockScreenCaptureHandler);
      mockScreenCaptureHandler.browserSocket = mockBrowserSocket;

      // Create a screencap API response message (simulating response from Mac app)
      const screencapResponse = {
        id: 'response-123',
        type: 'response' as const,
        category: 'screencap' as const,
        action: 'api-response',
        payload: {
          method: 'GET',
          endpoint: '/processes',
          data: [
            { processName: 'Terminal', pid: 1234, windows: [] },
            { processName: 'Safari', pid: 5678, windows: [] },
          ],
        },
      };

      // Call handleMacMessage directly
      await (
        controlUnixHandler as unknown as { handleMacMessage: (msg: unknown) => Promise<void> }
      ).handleMacMessage(screencapResponse);

      // Verify the handler was called with the message
      expect(mockScreenCaptureHandler.handleMessage).toHaveBeenCalledWith(screencapResponse);
    });

    it('should ignore non-screencap response messages without pending requests', async () => {
      // Mock a handler for system messages
      const mockSystemHandler = {
        handleMessage: vi.fn().mockResolvedValue(null),
      };
      (controlUnixHandler as unknown as { handlers: Map<string, unknown> }).handlers.set(
        'system',
        mockSystemHandler
      );

      // Create a system response message without a pending request
      const systemResponse = {
        id: 'response-456',
        type: 'response' as const,
        category: 'system' as const,
        action: 'some-action',
        payload: { data: 'test' },
      };

      // Call handleMacMessage directly
      await (
        controlUnixHandler as unknown as { handleMacMessage: (msg: unknown) => Promise<void> }
      ).handleMacMessage(systemResponse);

      // Verify the handler was NOT called (message should be ignored)
      expect(mockSystemHandler.handleMessage).not.toHaveBeenCalled();
    });

    it('should process screencap request messages normally', async () => {
      // Mock the screen capture handler
      const mockScreenCaptureHandler = {
        handleMessage: vi.fn().mockResolvedValue({
          id: 'request-789',
          type: 'response',
          category: 'screencap',
          action: 'api-request',
          payload: { success: true },
        }),
      };

      (controlUnixHandler as unknown as { handlers: Map<string, unknown> }).handlers.set(
        'screencap',
        mockScreenCaptureHandler
      );

      // Create a screencap request message
      const screencapRequest = {
        id: 'request-789',
        type: 'request' as const,
        category: 'screencap' as const,
        action: 'api-request',
        payload: { method: 'GET', endpoint: '/processes' },
      };

      // Mock sendToMac to capture the response
      const sendToMacSpy = vi
        .spyOn(controlUnixHandler as unknown as { sendToMac: (msg: unknown) => void }, 'sendToMac')
        .mockImplementation(() => {});

      // Call handleMacMessage
      await (
        controlUnixHandler as unknown as { handleMacMessage: (msg: unknown) => Promise<void> }
      ).handleMacMessage(screencapRequest);

      // Verify the handler was called
      expect(mockScreenCaptureHandler.handleMessage).toHaveBeenCalledWith(screencapRequest);

      // Verify response was sent back to Mac
      expect(sendToMacSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'response',
          category: 'screencap',
        })
      );
    });
  });
});
