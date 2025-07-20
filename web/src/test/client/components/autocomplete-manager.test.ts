import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../../client/components/autocomplete-manager.js';
import { AutocompleteManager } from '../../../client/components/autocomplete-manager.js';
import type { AuthClient } from '../../../client/services/auth-client.js';

// Mock the global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AutocompleteManager', () => {
  let manager: AutocompleteManager;
  let mockAuthClient: AuthClient;

  beforeEach(() => {
    // Mock auth client
    mockAuthClient = {
      getAuthHeader: vi.fn().mockReturnValue({ Authorization: 'Bearer test-token' }),
    } as unknown as AuthClient;

    manager = new AutocompleteManager(mockAuthClient);
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchCompletions', () => {
    it('should return empty array for empty path', async () => {
      const result = await manager.fetchCompletions('');
      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should fetch filesystem completions from API', async () => {
      const mockCompletions = [
        {
          name: 'Documents',
          path: '~/Documents',
          type: 'directory' as const,
          suggestion: '~/Documents/',
        },
        {
          name: 'Downloads',
          path: '~/Downloads',
          type: 'directory' as const,
          suggestion: '~/Downloads/',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ completions: mockCompletions }),
      });

      const result = await manager.fetchCompletions('~/Do');

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/fs/completions?path=${encodeURIComponent('~/Do')}`,
        {
          headers: { Authorization: 'Bearer test-token' },
        }
      );
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Documents');
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await manager.fetchCompletions('~/test');

      expect(result).toEqual([]);
    });

    it('should search repositories by partial name', async () => {
      const repositories: Repository[] = [
        {
          id: '1',
          path: '/Users/test/Projects/vibetunnel',
          folderName: 'vibetunnel',
          lastModified: '2024-01-01',
          relativePath: '~/Projects/vibetunnel',
        },
        {
          id: '2',
          path: '/Users/test/Projects/vibetunnel2',
          folderName: 'vibetunnel2',
          lastModified: '2024-01-02',
          relativePath: '~/Projects/vibetunnel2',
        },
        {
          id: '3',
          path: '/Users/test/Projects/other-project',
          folderName: 'other-project',
          lastModified: '2024-01-03',
          relativePath: '~/Projects/other-project',
        },
      ];

      manager.setRepositories(repositories);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ completions: [] }),
      });

      const result = await manager.fetchCompletions('vibe');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('vibetunnel');
      expect(result[0].isRepository).toBe(true);
      expect(result[1].name).toBe('vibetunnel2');
    });

    it('should merge filesystem and repository completions without duplicates', async () => {
      const repositories: Repository[] = [
        {
          id: '1',
          path: '/Users/test/Projects/myapp',
          folderName: 'myapp',
          lastModified: '2024-01-01',
          relativePath: '~/Projects/myapp',
        },
      ];

      manager.setRepositories(repositories);

      const mockCompletions = [
        {
          name: 'myapp',
          path: '~/Projects/myapp',
          type: 'directory' as const,
          suggestion: '/Users/test/Projects/myapp',
          isRepository: true,
        },
        {
          name: 'myapp-docs',
          path: '~/Projects/myapp-docs',
          type: 'directory' as const,
          suggestion: '~/Projects/myapp-docs/',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ completions: mockCompletions }),
      });

      const result = await manager.fetchCompletions('myapp');

      // Should not have duplicates
      const uniqueSuggestions = new Set(result.map((r) => r.suggestion));
      expect(uniqueSuggestions.size).toBe(result.length);
    });
  });

  describe('sortCompletions', () => {
    it('should prioritize exact name matches', async () => {
      const mockCompletions = [
        {
          name: 'project-test',
          path: '~/project-test',
          type: 'directory' as const,
          suggestion: '~/project-test/',
        },
        {
          name: 'test',
          path: '~/test',
          type: 'directory' as const,
          suggestion: '~/test/',
        },
        {
          name: 'testing',
          path: '~/testing',
          type: 'directory' as const,
          suggestion: '~/testing/',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ completions: mockCompletions }),
      });

      const result = await manager.fetchCompletions('~/test');

      expect(result[0].name).toBe('test'); // Exact match should be first
    });

    it('should prioritize items that start with search term', async () => {
      const mockCompletions = [
        {
          name: 'myproject',
          path: '~/myproject',
          type: 'directory' as const,
          suggestion: '~/myproject/',
        },
        {
          name: 'project',
          path: '~/project',
          type: 'directory' as const,
          suggestion: '~/project/',
        },
        {
          name: 'proj',
          path: '~/proj',
          type: 'directory' as const,
          suggestion: '~/proj/',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ completions: mockCompletions }),
      });

      const result = await manager.fetchCompletions('~/proj');

      expect(result[0].name).toBe('proj');
      expect(result[1].name).toBe('project');
    });

    it('should prioritize directories over files', async () => {
      const mockCompletions = [
        {
          name: 'readme.md',
          path: '~/readme.md',
          type: 'file' as const,
          suggestion: '~/readme.md',
        },
        {
          name: 'Documents',
          path: '~/Documents',
          type: 'directory' as const,
          suggestion: '~/Documents/',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ completions: mockCompletions }),
      });

      const result = await manager.fetchCompletions('~/');

      expect(result[0].type).toBe('directory');
      expect(result[1].type).toBe('file');
    });

    it('should prioritize git repositories over regular directories', async () => {
      const mockCompletions = [
        {
          name: 'regular-folder',
          path: '~/regular-folder',
          type: 'directory' as const,
          suggestion: '~/regular-folder/',
          isRepository: false,
        },
        {
          name: 'git-project',
          path: '~/git-project',
          type: 'directory' as const,
          suggestion: '~/git-project/',
          isRepository: true,
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ completions: mockCompletions }),
      });

      const result = await manager.fetchCompletions('~/');

      expect(result[0].isRepository).toBe(true);
      expect(result[1].isRepository).toBeFalsy();
    });

    it('should return sorted results', async () => {
      const mockCompletions = [
        {
          name: 'zebra',
          path: '~/zebra',
          type: 'directory' as const,
          suggestion: '~/zebra/',
        },
        {
          name: 'apple',
          path: '~/apple',
          type: 'directory' as const,
          suggestion: '~/apple/',
        },
        {
          name: 'banana',
          path: '~/banana',
          type: 'directory' as const,
          suggestion: '~/banana/',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ completions: mockCompletions }),
      });

      const result = await manager.fetchCompletions('~/');

      // Should be sorted alphabetically
      expect(result[0].name).toBe('apple');
      expect(result[1].name).toBe('banana');
      expect(result[2].name).toBe('zebra');
    });

    it('should limit results to 20 items', async () => {
      // Create 25 mock completions
      const mockCompletions = Array.from({ length: 25 }, (_, i) => ({
        name: `folder${i}`,
        path: `~/folder${i}`,
        type: 'directory' as const,
        suggestion: `~/folder${i}/`,
      }));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ completions: mockCompletions }),
      });

      const result = await manager.fetchCompletions('~/folder');

      expect(result).toHaveLength(20);
    });
  });

  describe('filterCompletions', () => {
    it('should filter completions by search term', () => {
      const completions = [
        {
          name: 'Documents',
          path: '~/Documents',
          type: 'directory' as const,
          suggestion: '~/Documents/',
        },
        {
          name: 'Downloads',
          path: '~/Downloads',
          type: 'directory' as const,
          suggestion: '~/Downloads/',
        },
        {
          name: 'Desktop',
          path: '~/Desktop',
          type: 'directory' as const,
          suggestion: '~/Desktop/',
        },
      ];

      const result = manager.filterCompletions(completions, 'down');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Downloads');
    });

    it('should match on both name and path', () => {
      const completions = [
        {
          name: 'project',
          path: '~/Documents/work/project',
          type: 'directory' as const,
          suggestion: '~/Documents/work/project/',
        },
        {
          name: 'notes',
          path: '~/work/notes',
          type: 'directory' as const,
          suggestion: '~/work/notes/',
        },
      ];

      const result = manager.filterCompletions(completions, 'work');

      expect(result).toHaveLength(2); // Both match because 'work' is in their paths
    });

    it('should return all items when search term is empty', () => {
      const completions = [
        {
          name: 'folder1',
          path: '~/folder1',
          type: 'directory' as const,
          suggestion: '~/folder1/',
        },
        {
          name: 'folder2',
          path: '~/folder2',
          type: 'directory' as const,
          suggestion: '~/folder2/',
        },
      ];

      const result = manager.filterCompletions(completions, '');

      expect(result).toHaveLength(2);
    });
  });

  describe('setAuthClient', () => {
    it('should update auth client', async () => {
      const newAuthClient = {
        getAuthHeader: vi.fn().mockReturnValue({ Authorization: 'Bearer new-token' }),
      } as unknown as AuthClient;

      manager.setAuthClient(newAuthClient);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ completions: [] }),
      });

      await manager.fetchCompletions('~/test');

      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), {
        headers: { Authorization: 'Bearer new-token' },
      });
    });
  });

  describe('setRepositories', () => {
    it('should update repositories list', async () => {
      const repositories: Repository[] = [
        {
          id: '1',
          path: '/Users/test/Projects/test-repo',
          folderName: 'test-repo',
          lastModified: '2024-01-01',
          relativePath: '~/Projects/test-repo',
        },
      ];

      manager.setRepositories(repositories);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ completions: [] }),
      });

      const result = await manager.fetchCompletions('test');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('test-repo');
    });
  });
});
