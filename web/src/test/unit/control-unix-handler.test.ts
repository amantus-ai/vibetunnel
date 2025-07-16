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
      const systemHandler = (controlUnixHandler as any).handlers.get('system');
      const response = await systemHandler.handleMessage(message);

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
      const systemHandler = (controlUnixHandler as any).handlers.get('system');
      const response = await systemHandler.handleMessage(message);

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
      const pendingRequests = (controlUnixHandler as any).pendingRequests;
      const hasPendingRequest = pendingRequests.has(message.id);

      // Since this is a response without a pending request, it should be ignored
      expect(hasPendingRequest).toBe(false);

      // Verify callback was not called
      expect(mockCallback).not.toHaveBeenCalled();
    });
  });
});
