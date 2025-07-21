import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuickStartCommand } from '../../types/config.js';
import type { AuthClient } from './auth-client.js';
import { type ServerConfig, ServerConfigService } from './server-config-service.js';

// Mock the logger
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock response data
const mockServerConfig: ServerConfig = {
  repositoryBasePath: '/Users/test/repos',
  serverConfigured: true,
  quickStartCommands: [{ name: '✨ claude', command: 'claude' }, { command: 'zsh' }],
};

describe('ServerConfigService', () => {
  let service: ServerConfigService;
  let fetchMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Reset fetch mock
    fetchMock = vi.spyOn(global, 'fetch');
    service = new ServerConfigService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadConfig', () => {
    it('should load config from server', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockServerConfig,
      } as Response);

      const config = await service.loadConfig();

      expect(fetchMock).toHaveBeenCalledWith('/api/config', {
        headers: {},
      });
      expect(config).toEqual(mockServerConfig);
    });

    it('should include auth header when authClient is set', async () => {
      const mockAuthClient = {
        getAuthHeader: () => ({ Authorization: 'Bearer test-token' }),
      } as AuthClient;

      service.setAuthClient(mockAuthClient);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockServerConfig,
      } as Response);

      await service.loadConfig();

      expect(fetchMock).toHaveBeenCalledWith('/api/config', {
        headers: { Authorization: 'Bearer test-token' },
      });
    });

    it('should return cached config when not expired', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockServerConfig,
      } as Response);

      // First load
      const config1 = await service.loadConfig();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second load should use cache
      const config2 = await service.loadConfig();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(config2).toEqual(config1);
    });

    it('should refresh config when forceRefresh is true', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockServerConfig,
      } as Response);

      // First load
      await service.loadConfig();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Force refresh
      await service.loadConfig(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should return default config on error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const config = await service.loadConfig();

      expect(config).toEqual({
        repositoryBasePath: '~/Documents',
        serverConfigured: false,
        quickStartCommands: [],
      });
    });

    it('should handle non-ok response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      } as Response);

      const config = await service.loadConfig();

      expect(config).toEqual({
        repositoryBasePath: '~/Documents',
        serverConfigured: false,
        quickStartCommands: [],
      });
    });
  });

  describe('updateQuickStartCommands', () => {
    it('should update quick start commands', async () => {
      const newCommands: QuickStartCommand[] = [
        { name: 'Python', command: 'python3' },
        { command: 'node' },
      ];

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      await service.updateQuickStartCommands(newCommands);

      expect(fetchMock).toHaveBeenCalledWith('/api/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ quickStartCommands: newCommands }),
      });
    });

    it('should filter invalid commands', async () => {
      const commands: QuickStartCommand[] = [
        { name: 'Valid', command: 'valid' },
        { command: '' }, // Invalid - empty command
        { command: '   ' }, // Invalid - whitespace only
        { command: 'valid2' },
      ];

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      await service.updateQuickStartCommands(commands);

      expect(fetchMock).toHaveBeenCalledWith('/api/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quickStartCommands: [{ name: 'Valid', command: 'valid' }, { command: 'valid2' }],
        }),
      });
    });

    it('should throw on invalid input', async () => {
      await expect(
        service.updateQuickStartCommands(null as unknown as QuickStartCommand[])
      ).rejects.toThrow('Invalid quick start commands');
      await expect(
        service.updateQuickStartCommands(undefined as unknown as QuickStartCommand[])
      ).rejects.toThrow('Invalid quick start commands');
    });

    it('should throw on server error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
      } as Response);

      await expect(service.updateQuickStartCommands([])).rejects.toThrow(
        'Failed to update config: Bad Request'
      );
    });

    it('should clear cache after update', async () => {
      // Load config to populate cache
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockServerConfig,
      } as Response);
      await service.loadConfig();

      // Update commands
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);
      await service.updateQuickStartCommands([]);

      // Next load should fetch from server (cache cleared)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockServerConfig,
      } as Response);
      await service.loadConfig();

      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('helper methods', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockServerConfig,
      } as Response);
    });

    it('getRepositoryBasePath should return repository path', async () => {
      const path = await service.getRepositoryBasePath();
      expect(path).toBe('/Users/test/repos');
    });

    it('getRepositoryBasePath should return default when not set', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockServerConfig, repositoryBasePath: undefined }),
      } as Response);

      const path = await service.getRepositoryBasePath();
      expect(path).toBe('~/Documents');
    });

    it('isServerConfigured should return server configured status', async () => {
      const configured = await service.isServerConfigured();
      expect(configured).toBe(true);
    });

    it('isServerConfigured should return false when not set', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockServerConfig, serverConfigured: undefined }),
      } as Response);

      const configured = await service.isServerConfigured();
      expect(configured).toBe(false);
    });

    it('getQuickStartCommands should return commands', async () => {
      const commands = await service.getQuickStartCommands();
      expect(commands).toEqual(mockServerConfig.quickStartCommands);
    });

    it('getQuickStartCommands should return empty array when not set', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockServerConfig, quickStartCommands: undefined }),
      } as Response);

      const commands = await service.getQuickStartCommands();
      expect(commands).toEqual([]);
    });
  });

  describe('setAuthClient', () => {
    it('should clear cache when auth client changes', async () => {
      // Load config to populate cache
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockServerConfig,
      } as Response);
      await service.loadConfig();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Set new auth client
      const mockAuthClient = {
        getAuthHeader: () => ({ Authorization: 'Bearer new-token' }),
      } as AuthClient;
      service.setAuthClient(mockAuthClient);

      // Next load should fetch from server (cache cleared)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockServerConfig,
      } as Response);
      await service.loadConfig();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenLastCalledWith('/api/config', {
        headers: { Authorization: 'Bearer new-token' },
      });
    });
  });
});
