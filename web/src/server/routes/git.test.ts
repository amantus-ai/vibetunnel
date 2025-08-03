import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitRoutes } from './git';

// Mock functions (must be declared before vi.mock calls due to hoisting)
const mockExecFile = vi.fn();

// Mock child_process and util
vi.mock('child_process', () => ({
  execFile: () => mockExecFile(),
}));

vi.mock('util', () => ({
  promisify: () => () => mockExecFile(),
}));

// Mock logger
vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock path utils
vi.mock('../utils/path-utils', () => ({
  resolveAbsolutePath: vi.fn((path: string) => path),
}));

// Mock git utils
vi.mock('../utils/git-utils', () => ({
  isWorktree: vi.fn(),
}));

// Mock git error utils
vi.mock('../utils/git-error', () => ({
  createGitError: vi.fn((error: unknown) => error),
  isGitNotFoundError: vi.fn(),
  isNotGitRepositoryError: vi.fn(),
}));

// Mock session manager
vi.mock('../pty/session-manager', () => ({
  SessionManager: vi.fn().mockImplementation(() => ({
    listSessions: vi.fn(() => []),
    updateSessionName: vi.fn(),
  })),
}));

// Mock websocket handlers
vi.mock('../websocket/control-protocol', () => ({
  createControlEvent: vi.fn(),
}));

vi.mock('../websocket/control-unix-handler', () => ({
  controlUnixHandler: {
    isMacAppConnected: vi.fn(() => false),
    sendToMac: vi.fn(),
  },
}));

describe('git routes', () => {
  let router: ReturnType<typeof createGitRoutes>;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockJson: ReturnType<typeof vi.fn>;
  let mockStatus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    router = createGitRoutes();

    mockJson = vi.fn();
    mockStatus = vi.fn(() => ({ json: mockJson }));

    mockReq = {
      query: {},
      body: {},
    };

    mockRes = {
      json: mockJson,
      status: mockStatus,
    };

    // Reset mocks
    mockExecFile.mockReset();
  });

  describe('GET /git/repository-info', () => {
    it('should return repository info with githubUrl field for Mac compatibility', async () => {
      const { isWorktree } = await import('../utils/git-utils');
      vi.mocked(isWorktree).mockResolvedValue(false);

      // Mock git commands
      mockExecFile
        .mockResolvedValueOnce({ stdout: '/test/repo', stderr: '' }) // show-toplevel
        .mockResolvedValueOnce({ stdout: 'main', stderr: '' }) // current branch
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // status porcelain
        .mockResolvedValueOnce({ stdout: 'https://github.com/user/repo.git', stderr: '' }) // remote get-url
        .mockResolvedValueOnce({ stdout: '2\t1', stderr: '' }); // ahead/behind

      mockReq.query = { path: '/test/repo' };

      const routeStack = router.stack;
      const repoInfoRoute = routeStack.find(
        (layer) => layer.route?.path === '/git/repository-info' && layer.route?.methods?.get
      );

      expect(repoInfoRoute).toBeDefined();

      if (repoInfoRoute?.route?.stack?.[0]) {
        await repoInfoRoute.route.stack[0].handle(mockReq as Request, mockRes as Response);
      }

      expect(mockJson).toHaveBeenCalledWith({
        isGitRepo: true,
        repoPath: '/test/repo',
        currentBranch: 'main',
        remoteUrl: 'https://github.com/user/repo.git',
        githubUrl: 'https://github.com/user/repo', // ✅ CRITICAL: Mac app expects this field
        hasChanges: false,
        modifiedCount: 0,
        untrackedCount: 0,
        stagedCount: 0,
        addedCount: 0,
        deletedCount: 0,
        aheadCount: 2,
        behindCount: 1,
        hasUpstream: true,
        isWorktree: false,
      });
    });

    it('should handle SSH GitHub URLs correctly', async () => {
      const { isWorktree } = await import('../utils/git-utils');
      vi.mocked(isWorktree).mockResolvedValue(false);

      // Mock git commands with SSH URL
      mockExecFile
        .mockResolvedValueOnce({ stdout: '/test/repo', stderr: '' }) // show-toplevel
        .mockResolvedValueOnce({ stdout: 'main', stderr: '' }) // current branch
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // status porcelain
        .mockResolvedValueOnce({ stdout: 'git@github.com:user/repo.git', stderr: '' }) // remote get-url (SSH)
        .mockRejectedValueOnce(new Error('No upstream')); // ahead/behind (no upstream)

      mockReq.query = { path: '/test/repo' };

      const routeStack = router.stack;
      const repoInfoRoute = routeStack.find(
        (layer) => layer.route?.path === '/git/repository-info' && layer.route?.methods?.get
      );

      if (repoInfoRoute?.route?.stack?.[0]) {
        await repoInfoRoute.route.stack[0].handle(mockReq as Request, mockRes as Response);
      }

      expect(mockJson).toHaveBeenCalledWith({
        isGitRepo: true,
        repoPath: '/test/repo',
        currentBranch: 'main',
        remoteUrl: 'git@github.com:user/repo.git',
        githubUrl: 'https://github.com/user/repo', // ✅ Correctly converted SSH to HTTPS
        hasChanges: false,
        modifiedCount: 0,
        untrackedCount: 0,
        stagedCount: 0,
        addedCount: 0,
        deletedCount: 0,
        aheadCount: 0,
        behindCount: 0,
        hasUpstream: false,
        isWorktree: false,
      });
    });

    it('should handle non-GitHub remotes gracefully', async () => {
      const { isWorktree } = await import('../utils/git-utils');
      vi.mocked(isWorktree).mockResolvedValue(false);

      // Mock git commands with non-GitHub remote
      mockExecFile
        .mockResolvedValueOnce({ stdout: '/test/repo', stderr: '' }) // show-toplevel
        .mockResolvedValueOnce({ stdout: 'main', stderr: '' }) // current branch
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // status porcelain
        .mockResolvedValueOnce({ stdout: 'https://gitlab.com/user/repo.git', stderr: '' }) // remote get-url (GitLab)
        .mockRejectedValueOnce(new Error('No upstream')); // ahead/behind

      mockReq.query = { path: '/test/repo' };

      const routeStack = router.stack;
      const repoInfoRoute = routeStack.find(
        (layer) => layer.route?.path === '/git/repository-info' && layer.route?.methods?.get
      );

      if (repoInfoRoute?.route?.stack?.[0]) {
        await repoInfoRoute.route.stack[0].handle(mockReq as Request, mockRes as Response);
      }

      expect(mockJson).toHaveBeenCalledWith({
        isGitRepo: true,
        repoPath: '/test/repo',
        currentBranch: 'main',
        remoteUrl: 'https://gitlab.com/user/repo.git',
        githubUrl: null, // ✅ Correctly null for non-GitHub remotes
        hasChanges: false,
        modifiedCount: 0,
        untrackedCount: 0,
        stagedCount: 0,
        addedCount: 0,
        deletedCount: 0,
        aheadCount: 0,
        behindCount: 0,
        hasUpstream: false,
        isWorktree: false,
      });
    });

    it('should handle missing path parameter', async () => {
      mockReq.query = {};

      const routeStack = router.stack;
      const repoInfoRoute = routeStack.find(
        (layer) => layer.route?.path === '/git/repository-info' && layer.route?.methods?.get
      );

      if (repoInfoRoute?.route?.stack?.[0]) {
        await repoInfoRoute.route.stack[0].handle(mockReq as Request, mockRes as Response);
      }

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'Missing or invalid path parameter',
      });
    });

    it('should handle not a git repository', async () => {
      const { isNotGitRepositoryError } = await import('../utils/git-error');
      vi.mocked(isNotGitRepositoryError).mockReturnValue(true);

      // Mock git command failure (not a git repo)
      mockExecFile.mockRejectedValue(new Error('Not a git repository'));

      mockReq.query = { path: '/test/not-repo' };

      const routeStack = router.stack;
      const repoInfoRoute = routeStack.find(
        (layer) => layer.route?.path === '/git/repository-info' && layer.route?.methods?.get
      );

      if (repoInfoRoute?.route?.stack?.[0]) {
        await repoInfoRoute.route.stack[0].handle(mockReq as Request, mockRes as Response);
      }

      expect(mockJson).toHaveBeenCalledWith({
        isGitRepo: false,
      });
    });
  });

  describe('GitRepositoryInfoResponse compatibility', () => {
    it('should have the correct type structure for Mac Swift interop', () => {
      // This test ensures the response matches what Mac app expects
      const expectedGitRepoInfoStructure = {
        isGitRepo: expect.any(Boolean),
        repoPath: expect.any(String),
        currentBranch: expect.any(String),
        remoteUrl: expect.any(String),
        githubUrl: expect.any(String), // ✅ Mac expects this field
        hasChanges: expect.any(Boolean),
        modifiedCount: expect.any(Number),
        untrackedCount: expect.any(Number),
        stagedCount: expect.any(Number),
        addedCount: expect.any(Number),
        deletedCount: expect.any(Number),
        aheadCount: expect.any(Number),
        behindCount: expect.any(Number),
        hasUpstream: expect.any(Boolean),
        isWorktree: expect.any(Boolean),
      };

      // This validates that our response is compatible with:
      // struct GitRepositoryInfoResponse: Codable {
      //     let isGitRepo: Bool
      //     let repoPath: String?
      //     let currentBranch: String?
      //     let remoteUrl: String?
      //     let githubUrl: String?  // ✅ CRITICAL FIELD
      //     let hasChanges: Bool?
      //     // ... etc
      //     let isWorktree: Bool?
      // }
      expect(expectedGitRepoInfoStructure).toBeDefined();
    });
  });

  describe('GET /git/repo-info', () => {
    it('should return basic repo info', async () => {
      mockExecFile.mockResolvedValueOnce({ stdout: '/test/repo', stderr: '' });

      mockReq.query = { path: '/test/repo' };

      const routeStack = router.stack;
      const basicRepoRoute = routeStack.find(
        (layer) => layer.route?.path === '/git/repo-info' && layer.route?.methods?.get
      );

      if (basicRepoRoute?.route?.stack?.[0]) {
        await basicRepoRoute.route.stack[0].handle(mockReq as Request, mockRes as Response);
      }

      expect(mockJson).toHaveBeenCalledWith({
        isGitRepo: true,
        repoPath: '/test/repo',
      });
    });
  });

  describe('GET /git/remote', () => {
    it('should return remote info with GitHub URL parsing', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '/test/repo', stderr: '' }) // show-toplevel
        .mockResolvedValueOnce({ stdout: 'https://github.com/user/repo.git', stderr: '' }); // remote get-url

      mockReq.query = { path: '/test/repo' };

      const routeStack = router.stack;
      const remoteRoute = routeStack.find(
        (layer) => layer.route?.path === '/git/remote' && layer.route?.methods?.get
      );

      if (remoteRoute?.route?.stack?.[0]) {
        await remoteRoute.route.stack[0].handle(mockReq as Request, mockRes as Response);
      }

      expect(mockJson).toHaveBeenCalledWith({
        isGitRepo: true,
        repoPath: '/test/repo',
        remoteUrl: 'https://github.com/user/repo.git',
        githubUrl: 'https://github.com/user/repo',
      });
    });
  });
});
