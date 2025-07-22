// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupFetchMock } from '@/test/utils/component-helpers';
import type { AuthClient } from './auth-client';
import { GitService } from './git-service';

describe('GitService', () => {
  let gitService: GitService;
  let fetchMock: ReturnType<typeof setupFetchMock>;
  let mockAuthClient: AuthClient;

  beforeEach(() => {
    // Setup fetch mock
    fetchMock = setupFetchMock();

    // Mock global fetch to use our mock
    global.fetch = fetchMock;

    // Create mock auth client
    mockAuthClient = {
      getAuthHeader: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
    } as unknown as AuthClient;

    // Create service instance
    gitService = new GitService(mockAuthClient);
  });

  afterEach(() => {
    fetchMock.clear();
    vi.clearAllMocks();
  });

  describe('checkGitRepo', () => {
    it('should check if path is a Git repository', async () => {
      const mockResponse = {
        isGitRepo: true,
        repoPath: '/home/user/project',
      };

      // Use vi.fn to mock fetch with custom logic
      const mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/api/git/repo-info')) {
          return {
            ok: true,
            status: 200,
            json: async () => mockResponse,
          };
        }
        throw new Error('Unexpected URL');
      });
      global.fetch = mockFetch as typeof global.fetch;

      const result = await gitService.checkGitRepo('/home/user/project/src');

      expect(result).toEqual(mockResponse);
      expect(mockAuthClient.getAuthHeader).toHaveBeenCalled();

      // Check the request
      expect(mockFetch).toHaveBeenCalled();
      const call = mockFetch.mock.calls[0];
      expect(call[0]).toContain('/api/git/repo-info');
      expect(call[0]).toContain('path=%2Fhome%2Fuser%2Fproject%2Fsrc');
      expect(call[1]?.headers).toEqual({ Authorization: 'Bearer test-token' });
    });

    it('should handle non-Git directories', async () => {
      const mockResponse = {
        isGitRepo: false,
      };

      const mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/api/git/repo-info')) {
          return {
            ok: true,
            status: 200,
            json: async () => mockResponse,
          };
        }
        throw new Error('Unexpected URL');
      });
      global.fetch = mockFetch as typeof global.fetch;

      const result = await gitService.checkGitRepo('/home/user/downloads');

      expect(result).toEqual(mockResponse);
      expect(result.repoPath).toBeUndefined();
    });

    it('should handle errors', async () => {
      const mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/api/git/repo-info')) {
          return {
            ok: false,
            status: 403,
            statusText: 'Forbidden',
            json: async () => ({ error: 'Permission denied' }),
          };
        }
        throw new Error('Unexpected URL');
      });
      global.fetch = mockFetch as typeof global.fetch;

      await expect(gitService.checkGitRepo('/restricted')).rejects.toThrow(
        'Failed to check git repo: Forbidden'
      );
    });
  });

  describe('listWorktrees', () => {
    it('should list all worktrees for a repository', async () => {
      const mockResponse = {
        worktrees: [
          {
            path: '/home/user/project',
            branch: 'main',
            HEAD: 'abc123',
            detached: false,
            isMainWorktree: true,
          },
          {
            path: '/home/user/project-feature',
            branch: 'feature',
            HEAD: 'def456',
            detached: false,
          },
        ],
        baseBranch: 'main',
      };

      const mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/api/worktrees')) {
          return {
            ok: true,
            status: 200,
            json: async () => mockResponse,
          };
        }
        throw new Error('Unexpected URL');
      });
      global.fetch = mockFetch as typeof global.fetch;

      const result = await gitService.listWorktrees('/home/user/project');

      expect(result).toEqual(mockResponse);
      expect(mockAuthClient.getAuthHeader).toHaveBeenCalled();

      // Check the request
      const call = mockFetch.mock.calls[0];
      expect(call[0]).toContain('/api/worktrees');
      expect(call[0]).toContain('repoPath=%2Fhome%2Fuser%2Fproject');
    });

    it('should handle errors', async () => {
      const mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/api/worktrees')) {
          return {
            ok: false,
            status: 404,
            statusText: 'Not Found',
            json: async () => ({ error: 'Not found' }),
          };
        }
        throw new Error('Unexpected URL');
      });
      global.fetch = mockFetch as typeof global.fetch;

      await expect(gitService.listWorktrees('/nonexistent')).rejects.toThrow(
        'Failed to list worktrees: Not Found'
      );
    });
  });

  describe('createWorktree', () => {
    it('should create a new worktree', async () => {
      const mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/api/worktrees')) {
          return {
            ok: true,
            status: 201,
            json: async () => ({}),
          };
        }
        throw new Error('Unexpected URL');
      });
      global.fetch = mockFetch as typeof global.fetch;

      await gitService.createWorktree(
        '/home/user/project',
        'new-feature',
        '/home/user/project-new-feature',
        'main'
      );

      const call = mockFetch.mock.calls[0];
      expect(call[0]).toBe('/api/worktrees');
      expect(call[1]?.method).toBe('POST');
      expect(call[1]?.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      });

      const requestBody = JSON.parse(call[1]?.body as string);
      expect(requestBody).toEqual({
        repoPath: '/home/user/project',
        branch: 'new-feature',
        path: '/home/user/project-new-feature',
        baseBranch: 'main',
      });
    });

    it('should handle creation without base branch', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: true,
        status: 201,
        json: async () => ({}),
      }));
      global.fetch = mockFetch as typeof global.fetch;

      await gitService.createWorktree(
        '/home/user/project',
        'new-feature',
        '/home/user/project-new-feature'
      );

      const call = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(call[1]?.body as string);
      expect(requestBody.baseBranch).toBeUndefined();
    });

    it('should handle creation errors', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Branch already exists' }),
      }));
      global.fetch = mockFetch as typeof global.fetch;

      await expect(
        gitService.createWorktree('/home/user/project', 'existing', '/home/user/project-existing')
      ).rejects.toThrow('Branch already exists');
    });
  });

  describe('deleteWorktree', () => {
    it('should delete a worktree', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: true,
        status: 204,
        json: async () => ({}),
      }));
      global.fetch = mockFetch as typeof global.fetch;

      await gitService.deleteWorktree('/home/user/project', 'feature');

      const call = mockFetch.mock.calls[0];
      expect(call[0]).toContain('/api/worktrees/feature');
      expect(call[0]).toContain('repoPath=%2Fhome%2Fuser%2Fproject');
      expect(call[1]?.method).toBe('DELETE');
    });

    it('should force delete a worktree', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: true,
        status: 204,
        json: async () => ({}),
      }));
      global.fetch = mockFetch as typeof global.fetch;

      await gitService.deleteWorktree('/home/user/project', 'feature', true);

      const call = mockFetch.mock.calls[0];
      expect(call[0]).toContain('/api/worktrees/feature');
      expect(call[0]).toContain('force=true');
    });

    it('should handle deletion errors', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Worktree has uncommitted changes' }),
      }));
      global.fetch = mockFetch as typeof global.fetch;

      await expect(gitService.deleteWorktree('/home/user/project', 'feature')).rejects.toThrow(
        'Worktree has uncommitted changes'
      );
    });
  });

  describe('pruneWorktrees', () => {
    it('should prune worktree information', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
      }));
      global.fetch = mockFetch as typeof global.fetch;

      await gitService.pruneWorktrees('/home/user/project');

      const call = mockFetch.mock.calls[0];
      expect(call[0]).toBe('/api/worktrees/prune');
      expect(call[1]?.method).toBe('POST');
      expect(call[1]?.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      });

      const requestBody = JSON.parse(call[1]?.body as string);
      expect(requestBody).toEqual({
        repoPath: '/home/user/project',
      });
    });

    it('should handle prune errors', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Failed to prune' }),
      }));
      global.fetch = mockFetch as typeof global.fetch;

      await expect(gitService.pruneWorktrees('/home/user/project')).rejects.toThrow(
        'Failed to prune worktrees'
      );
    });
  });

  describe('switchBranch', () => {
    it('should switch to a branch', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
      }));
      global.fetch = mockFetch as typeof global.fetch;

      await gitService.switchBranch('/home/user/project', 'develop');

      const call = mockFetch.mock.calls[0];
      expect(call[0]).toBe('/api/worktrees/switch');
      expect(call[1]?.method).toBe('POST');

      const requestBody = JSON.parse(call[1]?.body as string);
      expect(requestBody).toEqual({
        repoPath: '/home/user/project',
        branch: 'develop',
      });
    });

    it('should handle switch errors', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Branch not found' }),
      }));
      global.fetch = mockFetch as typeof global.fetch;

      await expect(gitService.switchBranch('/home/user/project', 'nonexistent')).rejects.toThrow(
        'Branch not found'
      );
    });
  });

  describe('setFollowMode', () => {
    it('should enable follow mode', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
      }));
      global.fetch = mockFetch as typeof global.fetch;

      await gitService.setFollowMode('/home/user/project', 'main', true);

      const call = mockFetch.mock.calls[0];
      expect(call[0]).toBe('/api/worktrees/follow');
      expect(call[1]?.method).toBe('POST');

      const requestBody = JSON.parse(call[1]?.body as string);
      expect(requestBody).toEqual({
        repoPath: '/home/user/project',
        branch: 'main',
        enable: true,
      });
    });

    it('should disable follow mode', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
      }));
      global.fetch = mockFetch as typeof global.fetch;

      await gitService.setFollowMode('/home/user/project', 'main', false);

      const call = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(call[1]?.body as string);
      expect(requestBody.enable).toBe(false);
    });

    it('should handle follow mode errors', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Invalid repository' }),
      }));
      global.fetch = mockFetch as typeof global.fetch;

      await expect(gitService.setFollowMode('/invalid', 'main', true)).rejects.toThrow(
        'Invalid repository'
      );
    });
  });

  describe('error handling', () => {
    it('should handle network errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      global.fetch = mockFetch as typeof global.fetch;

      await expect(gitService.checkGitRepo('/home/user/project')).rejects.toThrow('Network error');
    });

    it('should handle malformed responses', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      }));
      global.fetch = mockFetch as typeof global.fetch;

      await expect(gitService.checkGitRepo('/home/user/project')).rejects.toThrow();
    });

    it('should include auth headers in all requests', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
      }));
      global.fetch = mockFetch as typeof global.fetch;

      // Test various endpoints
      const endpoints = [
        () => gitService.checkGitRepo('/path'),
        () => gitService.listWorktrees('/repo'),
        () => gitService.createWorktree('/repo', 'branch', '/path'),
        () => gitService.deleteWorktree('/repo', 'branch'),
        () => gitService.pruneWorktrees('/repo'),
        () => gitService.switchBranch('/repo', 'branch'),
        () => gitService.setFollowMode('/repo', 'branch', true),
      ];

      for (const endpoint of endpoints) {
        mockFetch.mockClear();

        try {
          await endpoint();
        } catch {
          // Ignore errors, we just want to check headers
        }

        expect(mockFetch).toHaveBeenCalled();
        expect(mockAuthClient.getAuthHeader).toHaveBeenCalled();
      }
    });
  });
});
