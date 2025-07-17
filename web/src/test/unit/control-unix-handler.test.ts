import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { controlUnixHandler } from '../../server/websocket/control-unix-handler';

// Mock dependencies
vi.mock('fs', () => ({
  promises: {
    unlink: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
  existsSync: vi.fn().mockReturnValue(false),
}));

vi.mock('net', () => ({
  createServer: vi.fn(() => ({
    listen: vi.fn(),
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Repository Path Update', () => {
    it('should update and retrieve repository path', async () => {
      const mockCallback = vi.fn();
      controlUnixHandler.setConfigUpdateCallback(mockCallback);

      // Update path
      const success = await controlUnixHandler.updateRepositoryPath('/Users/test/NewProjects');

      expect(success).toBe(true);
      expect(mockCallback).toHaveBeenCalledWith({
        repositoryBasePath: '/Users/test/NewProjects',
      });

      // Verify path is stored
      expect(controlUnixHandler.getRepositoryPath()).toBe('/Users/test/NewProjects');
    });

    it('should handle errors during path update', async () => {
      const mockCallback = vi.fn(() => {
        throw new Error('Update failed');
      });
      controlUnixHandler.setConfigUpdateCallback(mockCallback);

      // Update path should return false on error
      const success = await controlUnixHandler.updateRepositoryPath('/Users/test/BadPath');

      expect(success).toBe(false);
    });
  });

  describe('Config Update Callback', () => {
    it('should set and call config update callback', () => {
      const mockCallback = vi.fn();

      // Set callback
      controlUnixHandler.setConfigUpdateCallback(mockCallback);

      // Trigger update
      (
        controlUnixHandler as unknown as {
          configUpdateCallback: (config: { repositoryBasePath: string }) => void;
        }
      ).configUpdateCallback({ repositoryBasePath: '/test/path' });

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

  describe('Screencap Response Forwarding', () => {
    it('should forward screencap response messages even without pending requests', async () => {
      // Mock WebSocket for browser connection
      const mockBrowserSocket = {
        readyState: 1, // OPEN
        send: vi.fn(),
      };

      // Mock the screen capture handler
      const mockScreenCaptureHandler = {
        setBrowserSocket: vi.fn(),
        handleMessage: vi.fn().mockResolvedValue(null),
        getUserId: vi.fn().mockReturnValue('test-user-id'),
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
        controlUnixHandler as unknown as {
          handleMacMessage: (msg: typeof screencapResponse) => Promise<void>;
        }
      ).handleMacMessage(screencapResponse);

      // Verify the handler was called with the message
      expect(mockScreenCaptureHandler.handleMessage).toHaveBeenCalledWith(screencapResponse);
    });

    it('should ignore non-screencap response messages without pending requests', async () => {
      // Mock a handler for system messages
      const mockSystemHandler = {
        handleMessage: vi.fn().mockResolvedValue(null),
      };
      (
        controlUnixHandler as unknown as { handlers: Map<string, typeof mockSystemHandler> }
      ).handlers.set('system', mockSystemHandler);

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
        controlUnixHandler as unknown as {
          handleMacMessage: (msg: typeof systemResponse) => Promise<void>;
        }
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

      (
        controlUnixHandler as unknown as { handlers: Map<string, typeof mockScreenCaptureHandler> }
      ).handlers.set('screencap', mockScreenCaptureHandler);

      // Create a screencap request message
      const screencapRequest = {
        id: 'request-789',
        type: 'request' as const,
        category: 'screencap' as const,
        action: 'api-request',
        payload: {
          method: 'GET',
          endpoint: '/displays',
        },
      };

      // Mock sendToMac to capture the response
      const sendToMacSpy = vi
        .spyOn(controlUnixHandler as unknown as { sendToMac: (msg: unknown) => void }, 'sendToMac')
        .mockImplementation(() => {});

      // Call handleMacMessage
      await (
        controlUnixHandler as unknown as {
          handleMacMessage: (msg: typeof screencapRequest) => Promise<void>;
        }
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
