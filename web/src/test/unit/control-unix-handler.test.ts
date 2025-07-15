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
});
