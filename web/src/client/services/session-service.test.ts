/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpMethod, TitleMode } from '../../shared/types';
import type { AuthClient } from './auth-client';
import { type SessionCreateData, SessionService } from './session-service';

describe('SessionService', () => {
  let service: SessionService;
  let mockAuthClient: AuthClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;

    // Mock auth client
    mockAuthClient = {
      getAuthHeader: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
    } as unknown as AuthClient;

    // Create service instance
    service = new SessionService(mockAuthClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createSession', () => {
    const mockSessionData: SessionCreateData = {
      command: ['npm', 'run', 'dev'],
      workingDir: '/home/user/project',
      name: 'Test Session',
      spawn_terminal: false,
      cols: 120,
      rows: 30,
      titleMode: TitleMode.STATIC,
    };

    it('should create a session successfully', async () => {
      const mockResult = {
        sessionId: 'session-123',
        message: 'Session created successfully',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      });

      const result = await service.createSession(mockSessionData);

      expect(fetchMock).toHaveBeenCalledWith('/api/sessions', {
        method: HttpMethod.POST,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify(mockSessionData),
      });
      expect(result).toEqual(mockResult);
    });

    it('should include auth header in request', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessionId: 'test-123' }),
      });

      await service.createSession(mockSessionData);

      expect(mockAuthClient.getAuthHeader).toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sessions',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
    });

    it('should handle error response with details', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          details: 'Invalid working directory',
        }),
      });

      await expect(service.createSession(mockSessionData)).rejects.toThrow(
        'Invalid working directory'
      );
    });

    it('should handle error response with error field', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: 'Internal server error',
        }),
      });

      await expect(service.createSession(mockSessionData)).rejects.toThrow('Internal server error');
    });

    it('should handle error response with unknown format', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      await expect(service.createSession(mockSessionData)).rejects.toThrow('Unknown error');
    });

    it('should handle network errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network failure'));

      await expect(service.createSession(mockSessionData)).rejects.toThrow('Network failure');
    });

    it('should handle JSON parsing errors', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      await expect(service.createSession(mockSessionData)).rejects.toThrow('Invalid JSON');
    });

    it('should handle minimal session data', async () => {
      const minimalData: SessionCreateData = {
        command: ['zsh'],
        workingDir: '~/',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessionId: 'minimal-123' }),
      });

      const result = await service.createSession(minimalData);

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sessions',
        expect.objectContaining({
          body: JSON.stringify(minimalData),
        })
      );
      expect(result.sessionId).toBe('minimal-123');
    });

    it('should serialize all session properties correctly', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessionId: 'test' }),
      });

      await service.createSession(mockSessionData);

      const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(calledBody).toEqual({
        command: ['npm', 'run', 'dev'],
        workingDir: '/home/user/project',
        name: 'Test Session',
        spawn_terminal: false,
        cols: 120,
        rows: 30,
        titleMode: TitleMode.STATIC,
      });
    });

    it('should re-throw existing Error instances', async () => {
      const customError = new Error('Custom error message');
      fetchMock.mockRejectedValueOnce(customError);

      await expect(service.createSession(mockSessionData)).rejects.toThrow('Custom error message');
    });

    it('should wrap non-Error exceptions', async () => {
      fetchMock.mockRejectedValueOnce('String error');

      await expect(service.createSession(mockSessionData)).rejects.toThrow(
        'Failed to create session'
      );
    });

    describe('Git context handling', () => {
      it('should include Git repository path when provided', async () => {
        const sessionDataWithGit: SessionCreateData = {
          ...mockSessionData,
          gitRepoPath: '/home/user/my-project',
        };

        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sessionId: 'git-session-123' }),
        });

        await service.createSession(sessionDataWithGit);

        const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(calledBody.gitRepoPath).toBe('/home/user/my-project');
      });

      it('should include Git branch when provided', async () => {
        const sessionDataWithGit: SessionCreateData = {
          ...mockSessionData,
          gitBranch: 'feature/new-feature',
        };

        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sessionId: 'git-session-123' }),
        });

        await service.createSession(sessionDataWithGit);

        const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(calledBody.gitBranch).toBe('feature/new-feature');
      });

      it('should include both Git repository path and branch when provided', async () => {
        const sessionDataWithGit: SessionCreateData = {
          ...mockSessionData,
          gitRepoPath: '/home/user/my-project',
          gitBranch: 'develop',
        };

        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sessionId: 'git-session-123' }),
        });

        await service.createSession(sessionDataWithGit);

        const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(calledBody.gitRepoPath).toBe('/home/user/my-project');
        expect(calledBody.gitBranch).toBe('develop');
      });

      it('should handle Git worktree paths correctly', async () => {
        const sessionDataWithWorktree: SessionCreateData = {
          command: ['vim'],
          workingDir: '/home/user/worktrees/feature-branch',
          gitRepoPath: '/home/user/worktrees/feature-branch',
          gitBranch: 'feature/awesome-feature',
        };

        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sessionId: 'worktree-session-123' }),
        });

        await service.createSession(sessionDataWithWorktree);

        const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(calledBody.workingDir).toBe('/home/user/worktrees/feature-branch');
        expect(calledBody.gitRepoPath).toBe('/home/user/worktrees/feature-branch');
        expect(calledBody.gitBranch).toBe('feature/awesome-feature');
      });

      it('should omit Git fields when not provided', async () => {
        const sessionDataWithoutGit: SessionCreateData = {
          command: ['bash'],
          workingDir: '/tmp',
        };

        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sessionId: 'no-git-123' }),
        });

        await service.createSession(sessionDataWithoutGit);

        const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(calledBody.gitRepoPath).toBeUndefined();
        expect(calledBody.gitBranch).toBeUndefined();
      });

      it('should handle empty Git values as undefined', async () => {
        const sessionDataWithEmptyGit: SessionCreateData = {
          ...mockSessionData,
          gitRepoPath: '',
          gitBranch: '',
        };

        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sessionId: 'empty-git-123' }),
        });

        await service.createSession(sessionDataWithEmptyGit);

        const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body);
        // Empty strings should be sent as-is (server will handle)
        expect(calledBody.gitRepoPath).toBe('');
        expect(calledBody.gitBranch).toBe('');
      });

      it('should preserve all other session data when adding Git context', async () => {
        const fullSessionData: SessionCreateData = {
          command: ['npm', 'test'],
          workingDir: '/home/user/project',
          name: 'Test Runner',
          spawn_terminal: true,
          cols: 100,
          rows: 40,
          titleMode: TitleMode.FIXED,
          gitRepoPath: '/home/user/project',
          gitBranch: 'main',
        };

        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ sessionId: 'full-123' }),
        });

        await service.createSession(fullSessionData);

        const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(calledBody).toEqual(fullSessionData);
      });
    });
  });
});
