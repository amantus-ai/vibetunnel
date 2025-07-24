import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { controlUnixHandler } from '../websocket/control-unix-handler';
import { createSessionRoutes } from './sessions';

// Mock dependencies
vi.mock('../websocket/control-unix-handler', () => ({
  controlUnixHandler: {
    isMacAppConnected: vi.fn(),
  },
}));

vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('sessions routes', () => {
  let mockPtyManager: {
    getSessions: ReturnType<typeof vi.fn>;
  };
  let mockTerminalManager: {
    getTerminal: ReturnType<typeof vi.fn>;
  };
  let mockStreamWatcher: {
    addListener: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
  };
  let mockActivityMonitor: {
    getSessionActivity: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create minimal mocks for required services
    mockPtyManager = {
      getSessions: vi.fn(() => []),
    };

    mockTerminalManager = {
      getTerminal: vi.fn(),
    };

    mockStreamWatcher = {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };

    mockActivityMonitor = {
      getSessionActivity: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /server/status', () => {
    it('should return server status with Mac app connection state', async () => {
      // Mock Mac app as connected
      vi.mocked(controlUnixHandler.isMacAppConnected).mockReturnValue(true);

      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: null,
        isHQMode: false,
        activityMonitor: mockActivityMonitor,
      });

      // Find the /server/status route handler
      const routes = (
        router as unknown as {
          stack: Array<{
            route?: {
              path: string;
              methods: { get?: boolean };
              stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
            };
          }>;
        }
      ).stack;
      const statusRoute = routes.find(
        (r) => r.route && r.route.path === '/server/status' && r.route.methods.get
      );

      expect(statusRoute).toBeTruthy();

      // Create mock request and response
      const mockReq = {} as Request;
      const mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      } as unknown as Response;

      // Call the route handler
      await statusRoute.route.stack[0].handle(mockReq, mockRes);

      // Verify response
      expect(mockRes.json).toHaveBeenCalledWith({
        macAppConnected: true,
        isHQMode: false,
        version: 'unknown', // Since VERSION env var is not set in tests
      });
    });

    it('should return Mac app disconnected when not connected', async () => {
      // Mock Mac app as disconnected
      vi.mocked(controlUnixHandler.isMacAppConnected).mockReturnValue(false);

      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: null,
        isHQMode: true,
        activityMonitor: mockActivityMonitor,
      });

      // Find the /server/status route handler
      const routes = (
        router as unknown as {
          stack: Array<{
            route?: {
              path: string;
              methods: { get?: boolean };
              stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
            };
          }>;
        }
      ).stack;
      const statusRoute = routes.find(
        (r) => r.route && r.route.path === '/server/status' && r.route.methods.get
      );

      const mockReq = {} as Request;
      const mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      } as unknown as Response;

      await statusRoute.route.stack[0].handle(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        macAppConnected: false,
        isHQMode: true,
        version: 'unknown',
      });
    });

    it('should handle errors gracefully', async () => {
      // Mock an error in isMacAppConnected
      vi.mocked(controlUnixHandler.isMacAppConnected).mockImplementation(() => {
        throw new Error('Connection check failed');
      });

      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: null,
        isHQMode: false,
        activityMonitor: mockActivityMonitor,
      });

      const routes = (
        router as unknown as {
          stack: Array<{
            route?: {
              path: string;
              methods: { get?: boolean };
              stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
            };
          }>;
        }
      ).stack;
      const statusRoute = routes.find(
        (r) => r.route && r.route.path === '/server/status' && r.route.methods.get
      );

      const mockReq = {} as Request;
      const mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      } as unknown as Response;

      await statusRoute.route.stack[0].handle(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to get server status',
      });
    });
  });

  describe('POST /sessions - Git detection', () => {
    let mockGitUtils: {
      getMainRepositoryPath: ReturnType<typeof vi.fn>;
    };
    let mockChildProcess: {
      execFile: ReturnType<typeof vi.fn>;
    };
    let mockFs: {
      promises: {
        stat: ReturnType<typeof vi.fn>;
      };
      existsSync: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      // Mock git-utils
      mockGitUtils = {
        getMainRepositoryPath: vi.fn(),
      };
      vi.doMock('../utils/git-utils', () => mockGitUtils);

      // Mock child_process.execFile
      mockChildProcess = {
        execFile: vi.fn(),
      };
      vi.doMock('child_process', () => ({
        execFile: (
          cmd: string,
          args: string[],
          opts: any,
          cb: (error: Error | null, stdout?: string) => void
        ) => {
          if (cb) {
            const result = mockChildProcess.execFile(cmd, args, opts);
            if (result instanceof Error) {
              cb(result);
            } else {
              cb(null, result);
            }
          }
          return { on: vi.fn(), stdout: { on: vi.fn() }, stderr: { on: vi.fn() } };
        },
      }));

      // Mock fs
      mockFs = {
        promises: {
          stat: vi.fn(),
        },
        existsSync: vi.fn(() => true),
      };
      vi.doMock('fs', () => ({
        ...mockFs,
        default: mockFs,
      }));

      // Update mockPtyManager to handle createSession
      mockPtyManager.createSession = vi.fn(() => ({
        sessionId: 'test-session-123',
        sessionInfo: {
          id: 'test-session-123',
          pid: 12345,
          name: 'Test Session',
          command: ['bash'],
          workingDir: '/test/repo',
        },
      }));
    });

    afterEach(() => {
      vi.doUnmock('../utils/git-utils');
      vi.doUnmock('child_process');
      vi.doUnmock('fs');
    });

    it('should detect Git repository information for regular repository', async () => {
      // Mock git commands for regular repository
      mockChildProcess.execFile
        .mockImplementationOnce(() => ({ stdout: '/test/repo\n' })) // git rev-parse --show-toplevel
        .mockImplementationOnce(() => ({ stdout: 'main\n' })) // git branch --show-current
        .mockImplementationOnce(() => ({
          stdout: '## main...origin/main [ahead 2, behind 1]\nM file1.txt\n?? file2.txt\n',
        })); // git status --porcelain=v1 --branch

      // Mock fs.stat to indicate .git is a directory (regular repo)
      mockFs.promises.stat.mockResolvedValueOnce({ isDirectory: () => true });

      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: null,
        isHQMode: false,
        activityMonitor: mockActivityMonitor,
      });

      // Find the POST /sessions route handler
      const routes = (router as any).stack;
      const createRoute = routes.find(
        (r: any) => r.route && r.route.path === '/sessions' && r.route.methods.post
      );

      const mockReq = {
        body: {
          command: ['bash'],
          workingDir: '/test/repo',
          name: 'Test Session',
          spawn_terminal: false,
        },
      } as Request;

      const mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      } as unknown as Response;

      await createRoute.route.stack[0].handle(mockReq, mockRes);

      // Verify Git detection was called
      expect(mockChildProcess.execFile).toHaveBeenCalledWith(
        'git',
        ['rev-parse', '--show-toplevel'],
        expect.objectContaining({
          cwd: '/test/repo',
          timeout: 5000,
        })
      );

      // Verify session was created with Git info
      expect(mockPtyManager.createSession).toHaveBeenCalledWith(
        ['bash'],
        expect.objectContaining({
          gitRepoPath: '/test/repo',
          gitBranch: 'main',
          gitAheadCount: 2,
          gitBehindCount: 1,
          gitHasChanges: true,
          gitIsWorktree: false,
        })
      );
    });

    it('should detect Git worktree information', async () => {
      // Mock git commands for worktree
      mockChildProcess.execFile
        .mockImplementationOnce(() => ({ stdout: '/test/worktree\n' }))
        .mockImplementationOnce(() => ({ stdout: 'feature/new-feature\n' }))
        .mockImplementationOnce(() => ({
          stdout: '## feature/new-feature...origin/feature/new-feature\n',
        }));

      // Mock fs.stat to indicate .git is a file (worktree)
      mockFs.promises.stat.mockResolvedValueOnce({ isDirectory: () => false });

      // Mock getMainRepositoryPath
      mockGitUtils.getMainRepositoryPath.mockResolvedValueOnce('/test/main-repo');

      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: null,
        isHQMode: false,
        activityMonitor: mockActivityMonitor,
      });

      const routes = (router as any).stack;
      const createRoute = routes.find(
        (r: any) => r.route && r.route.path === '/sessions' && r.route.methods.post
      );

      const mockReq = {
        body: {
          command: ['vim'],
          workingDir: '/test/worktree',
        },
      } as Request;

      const mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      } as unknown as Response;

      await createRoute.route.stack[0].handle(mockReq, mockRes);

      // Verify worktree detection
      expect(mockPtyManager.createSession).toHaveBeenCalledWith(
        ['vim'],
        expect.objectContaining({
          gitRepoPath: '/test/worktree',
          gitBranch: 'feature/new-feature',
          gitIsWorktree: true,
          gitMainRepoPath: '/test/main-repo',
        })
      );
    });

    it('should handle non-Git directories gracefully', async () => {
      // Mock git command to fail (not a git repo)
      mockChildProcess.execFile.mockImplementationOnce(() => {
        throw new Error('fatal: not a git repository');
      });

      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: null,
        isHQMode: false,
        activityMonitor: mockActivityMonitor,
      });

      const routes = (router as any).stack;
      const createRoute = routes.find(
        (r: any) => r.route && r.route.path === '/sessions' && r.route.methods.post
      );

      const mockReq = {
        body: {
          command: ['ls'],
          workingDir: '/tmp',
        },
      } as Request;

      const mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      } as unknown as Response;

      await createRoute.route.stack[0].handle(mockReq, mockRes);

      // Verify session was created without Git info
      expect(mockPtyManager.createSession).toHaveBeenCalledWith(
        ['ls'],
        expect.objectContaining({
          gitRepoPath: undefined,
          gitBranch: undefined,
          gitIsWorktree: undefined,
          gitMainRepoPath: undefined,
        })
      );

      // Should still create the session successfully
      expect(mockRes.json).toHaveBeenCalledWith({ sessionId: 'test-session-123' });
    });

    it('should handle detached HEAD state', async () => {
      // Mock git commands - detached HEAD
      mockChildProcess.execFile
        .mockImplementationOnce(() => ({ stdout: '/test/repo\n' }))
        .mockImplementationOnce(() => {
          throw new Error('fatal: ref HEAD is not a symbolic ref');
        });

      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: null,
        isHQMode: false,
        activityMonitor: mockActivityMonitor,
      });

      const routes = (router as any).stack;
      const createRoute = routes.find(
        (r: any) => r.route && r.route.path === '/sessions' && r.route.methods.post
      );

      const mockReq = {
        body: {
          command: ['git', 'log'],
          workingDir: '/test/repo',
        },
      } as Request;

      const mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      } as unknown as Response;

      await createRoute.route.stack[0].handle(mockReq, mockRes);

      // Should still have repo path but no branch
      expect(mockPtyManager.createSession).toHaveBeenCalledWith(
        ['git', 'log'],
        expect.objectContaining({
          gitRepoPath: '/test/repo',
          gitBranch: undefined,
        })
      );
    });

    it('should pass Git info to terminal spawn request', async () => {
      // Mock git commands
      mockChildProcess.execFile
        .mockImplementationOnce(() => ({ stdout: '/test/repo\n' }))
        .mockImplementationOnce(() => ({ stdout: 'develop\n' }))
        .mockImplementationOnce(() => ({
          stdout: '## develop...origin/develop\nM src/file.ts\n',
        }));

      mockFs.promises.stat.mockResolvedValueOnce({ isDirectory: () => true });

      // Mock control unix handler to simulate successful terminal spawn
      vi.mocked(controlUnixHandler).sendMessage = vi.fn().mockResolvedValueOnce({
        success: true,
        type: 'terminalSpawnResponse',
      });

      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: null,
        isHQMode: false,
        activityMonitor: mockActivityMonitor,
      });

      const routes = (router as any).stack;
      const createRoute = routes.find(
        (r: any) => r.route && r.route.path === '/sessions' && r.route.methods.post
      );

      const mockReq = {
        body: {
          command: ['zsh'],
          workingDir: '/test/repo',
          spawn_terminal: true, // Request terminal spawn
        },
      } as Request;

      const mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      } as unknown as Response;

      await createRoute.route.stack[0].handle(mockReq, mockRes);

      // Verify terminal spawn was called with Git info
      expect(controlUnixHandler.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'terminalSpawnRequest',
          gitRepoPath: '/test/repo',
          gitBranch: 'develop',
          gitHasChanges: true,
          gitIsWorktree: false,
        })
      );
    });
  });
});
