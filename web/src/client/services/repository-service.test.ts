/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../components/autocomplete-manager';
import type { AuthClient } from './auth-client';
import { RepositoryService } from './repository-service';

describe('RepositoryService', () => {
  let service: RepositoryService;
  let mockAuthClient: AuthClient;
  let fetchMock: ReturnType<typeof vi.fn>;
  let mockStorage: { [key: string]: string };

  beforeEach(() => {
    // Mock localStorage
    mockStorage = {};
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn((key: string) => mockStorage[key] || null),
        setItem: vi.fn((key: string, value: string) => {
          mockStorage[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete mockStorage[key];
        }),
        clear: vi.fn(() => {
          mockStorage = {};
        }),
      },
      writable: true,
      configurable: true,
    });

    // Mock fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;

    // Mock auth client
    mockAuthClient = {
      getAuthHeader: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
    } as unknown as AuthClient;

    // Create service instance
    service = new RepositoryService(mockAuthClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('discoverRepositories', () => {
    it('should fetch repositories with default base path', async () => {
      const mockRepositories: Repository[] = [
        {
          id: '1',
          path: '/home/user/project1',
          folderName: 'project1',
          lastModified: '2024-01-01',
          relativePath: '~/project1',
        },
        {
          id: '2',
          path: '/home/user/project2',
          folderName: 'project2',
          lastModified: '2024-01-02',
          relativePath: '~/project2',
        },
      ];

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRepositories,
      });

      const result = await service.discoverRepositories();

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/repositories/discover?path=${encodeURIComponent('~/')}`,
        {
          headers: { Authorization: 'Bearer test-token' },
        }
      );
      expect(result).toEqual(mockRepositories);
    });

    it('should use repository base path from preferences', async () => {
      // Set preferences in localStorage - using the correct key from unified-settings.js
      mockStorage.vibetunnel_app_preferences = JSON.stringify({
        repositoryBasePath: '/custom/path',
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await service.discoverRepositories();

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/repositories/discover?path=${encodeURIComponent('/custom/path')}`,
        {
          headers: { Authorization: 'Bearer test-token' },
        }
      );
    });

    it('should handle invalid preferences JSON', async () => {
      // Set invalid JSON in localStorage
      mockStorage.vibetunnel_app_preferences = 'invalid-json';

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await service.discoverRepositories();

      // Should fall back to default path
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/repositories/discover?path=${encodeURIComponent('~/')}`,
        {
          headers: { Authorization: 'Bearer test-token' },
        }
      );
    });

    it('should handle fetch errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await service.discoverRepositories();

      expect(result).toEqual([]);
    });

    it('should handle non-ok responses', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server error' }),
      });

      const result = await service.discoverRepositories();

      expect(result).toEqual([]);
    });

    it('should handle empty repository base path in preferences', async () => {
      mockStorage.vibetunnel_app_preferences = JSON.stringify({
        repositoryBasePath: '',
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await service.discoverRepositories();

      // Should fall back to default path
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/repositories/discover?path=${encodeURIComponent('~/')}`,
        {
          headers: { Authorization: 'Bearer test-token' },
        }
      );
    });

    it('should include auth header in request', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await service.discoverRepositories();

      expect(mockAuthClient.getAuthHeader).toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { Authorization: 'Bearer test-token' },
        })
      );
    });
  });
});
