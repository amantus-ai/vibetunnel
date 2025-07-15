import type { Socket } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlMessage } from '../../server/websocket/control-protocol';
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
}));

// Helper to create a mock Socket
const mockSocket = () => {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const socket = {
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(listener);
    }),
    write: vi.fn(),
    end: vi.fn(),
    // Helper to emit events
    emit: (event: string, ...args: unknown[]) => {
      if (listeners[event]) {
        listeners[event].forEach((listener) => listener(...args));
      }
    },
  };
  return socket as unknown as Socket;
};

describe('Control Unix Handler', () => {
  let mockMacSocket: ReturnType<typeof mockSocket>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMacSocket = mockSocket();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Repository Path Update', () => {
    it('should handle repository path update request', async () => {
      // Set up the config update callback
      const mockCallback = vi.fn();
      controlUnixHandler.setConfigUpdateCallback(mockCallback);

      // Simulate repository path update message from Mac app
      const updateMessage: ControlMessage = {
        id: 'test-id-123',
        type: 'request',
        category: 'system',
        action: 'repository-path-update',
        payload: { path: '/Users/test/Projects' },
      };

      // Mock the Mac socket connection
      (controlUnixHandler as unknown as { macSocket: Socket }).macSocket = mockMacSocket;

      // Handle the message
      const response = await (
        controlUnixHandler as unknown as {
          handleMacMessage: (msg: ControlMessage) => Promise<ControlMessage>;
        }
      ).handleMacMessage(updateMessage);

      // Verify the callback was called with the correct path
      expect(mockCallback).toHaveBeenCalledWith({
        repositoryBasePath: '/Users/test/Projects',
      });

      // Verify the response
      expect(response).toEqual({
        id: 'test-id-123',
        type: 'response',
        category: 'system',
        action: 'repository-path-update',
        payload: { success: true, path: '/Users/test/Projects' },
      });
    });

    it('should return error for missing path in payload', async () => {
      // Simulate repository path update message without path
      const updateMessage: ControlMessage = {
        id: 'test-id-456',
        type: 'request',
        category: 'system',
        action: 'repository-path-update',
        payload: {},
      };

      // Mock the Mac socket connection
      (controlUnixHandler as unknown as { macSocket: Socket }).macSocket = mockMacSocket;

      // Handle the message
      const response = await (
        controlUnixHandler as unknown as {
          handleMacMessage: (msg: ControlMessage) => Promise<ControlMessage>;
        }
      ).handleMacMessage(updateMessage);

      // Verify error response
      expect(response).toEqual({
        id: 'test-id-456',
        type: 'response',
        category: 'system',
        action: 'repository-path-update',
        error: 'Missing path in payload',
      });
    });

    it('should handle callback not being set', async () => {
      // Don't set callback
      const updateMessage: ControlMessage = {
        id: 'test-id-789',
        type: 'request',
        category: 'system',
        action: 'repository-path-update',
        payload: { path: '/Users/test/Projects' },
      };

      // Mock the Mac socket connection
      (controlUnixHandler as unknown as { macSocket: Socket }).macSocket = mockMacSocket;

      // Handle the message
      const response = await (
        controlUnixHandler as unknown as {
          handleMacMessage: (msg: ControlMessage) => Promise<ControlMessage>;
        }
      ).handleMacMessage(updateMessage);

      // Verify error response
      expect(response.error).toBe('Failed to update repository path');
    });

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
});
