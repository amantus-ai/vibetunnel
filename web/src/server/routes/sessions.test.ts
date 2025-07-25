import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectGitInfo } from '../utils/git-info';
import { controlUnixHandler } from '../websocket/control-unix-handler';
import { createSessionRoutes, requestTerminalSpawn } from './sessions';

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

vi.mock('../utils/git-info');

// Mock the sessions module but only override requestTerminalSpawn
vi.mock('./sessions', async () => {
  const actual = await vi.importActual('./sessions');
  return {
    ...actual,
    requestTerminalSpawn: vi.fn().mockResolvedValue({ success: false }),
  };
});

describe('sessions routes', () => {
  let mockPtyManager: {
    getSessions: ReturnType<typeof vi.fn>;
    createSession: ReturnType<typeof vi.fn>;
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

    // Set default mock return value for detectGitInfo - mock it to return test values
    vi.mocked(detectGitInfo).mockImplementation(async (dir: string) => {
      // Return different values based on the directory to make tests more predictable
      if (dir.includes('/test/repo')) {
        return {
          gitRepoPath: '/test/repo',
          gitBranch: 'main',
          gitAheadCount: 2,
          gitBehindCount: 1,
          gitHasChanges: true,
          gitIsWorktree: false,
          gitMainRepoPath: undefined,
        };
      } else if (dir.includes('/test/worktree')) {
        return {
          gitRepoPath: '/test/worktree',
          gitBranch: 'feature-branch',
          gitAheadCount: 0,
          gitBehindCount: 0,
          gitHasChanges: false,
          gitIsWorktree: true,
          gitMainRepoPath: '/test/main-repo',
        };
      }
      // Default response for other directories
      return {
        gitRepoPath: undefined,
        gitBranch: undefined,
        gitAheadCount: 0,
        gitBehindCount: 0,
        gitHasChanges: false,
        gitIsWorktree: false,
        gitMainRepoPath: undefined,
      };
    });

    // Create minimal mocks for required services
    mockPtyManager = {
      getSessions: vi.fn(() => []),
      createSession: vi.fn().mockResolvedValue({
        id: 'test-session-id',
        command: ['bash'],
        cwd: '/test/dir',
      }),
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
    beforeEach(async () => {
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
      vi.clearAllMocks();
    });

    it('should detect Git repository information for regular repository', async () => {
      // The mock is already set up to return regular repository info for /test/repo
      // based on our implementation in beforeEach

      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: null,
        isHQMode: false,
        activityMonitor: mockActivityMonitor,
      });

      // Find the POST /sessions route handler
      interface RouteLayer {
        route?: {
          path: string;
          methods: { post?: boolean };
        };
      }
      const routes = (router as { stack: RouteLayer[] }).stack;
      const createRoute = routes.find(
        (r) => r.route && r.route.path === '/sessions' && r.route.methods.post
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

      if (createRoute?.route?.stack?.[0]) {
        await createRoute.route.stack[0].handle(mockReq, mockRes);
      } else {
        throw new Error('Could not find POST /sessions route handler');
      }

      // Verify Git detection was called
      expect(vi.mocked(detectGitInfo)).toHaveBeenCalled();

      // Verify session was created
      expect(mockPtyManager.createSession).toHaveBeenCalled();
    });

    it('should detect Git worktree information', async () => {
      // Mock detectGitInfo to return worktree info
      vi.mocked(detectGitInfo).mockResolvedValueOnce({
        gitRepoPath: '/test/worktree',
        gitBranch: 'feature/new-feature',
        gitAheadCount: 0,
        gitBehindCount: 0,
        gitHasChanges: false,
        gitIsWorktree: true,
        gitMainRepoPath: '/test/main-repo',
      });

      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: null,
        isHQMode: false,
        activityMonitor: mockActivityMonitor,
      });

      interface RouteLayer {
        route?: {
          path: string;
          methods: { post?: boolean };
        };
      }
      const routes = (router as { stack: RouteLayer[] }).stack;
      const createRoute = routes.find(
        (r) => r.route && r.route.path === '/sessions' && r.route.methods.post
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

      if (createRoute?.route?.stack?.[0]) {
        await createRoute.route.stack[0].handle(mockReq, mockRes);
      } else {
        throw new Error('Could not find POST /sessions route handler');
      }

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
      // Mock detectGitInfo to return no Git info
      vi.mocked(detectGitInfo).mockResolvedValueOnce({
        gitRepoPath: undefined,
        gitBranch: undefined,
        gitAheadCount: 0,
        gitBehindCount: 0,
        gitHasChanges: false,
        gitIsWorktree: false,
        gitMainRepoPath: undefined,
      });

      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: null,
        isHQMode: false,
        activityMonitor: mockActivityMonitor,
      });

      interface RouteLayer {
        route?: {
          path: string;
          methods: { post?: boolean };
        };
      }
      const routes = (router as { stack: RouteLayer[] }).stack;
      const createRoute = routes.find(
        (r) => r.route && r.route.path === '/sessions' && r.route.methods.post
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

      if (createRoute?.route?.stack?.[0]) {
        await createRoute.route.stack[0].handle(mockReq, mockRes);
      } else {
        throw new Error('Could not find POST /sessions route handler');
      }

      // Verify session was created
      expect(mockPtyManager.createSession).toHaveBeenCalled();

      // Should still create the session successfully
      expect(mockRes.json).toHaveBeenCalledWith({ sessionId: 'test-session-123' });
    });

    it('should handle detached HEAD state', async () => {
      // Mock detectGitInfo to return detached HEAD state
      vi.mocked(detectGitInfo).mockResolvedValueOnce({
        gitRepoPath: '/test/repo',
        gitBranch: undefined, // No branch in detached HEAD
        gitAheadCount: 0,
        gitBehindCount: 0,
        gitHasChanges: false,
        gitIsWorktree: false,
        gitMainRepoPath: undefined,
      });

      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: null,
        isHQMode: false,
        activityMonitor: mockActivityMonitor,
      });

      interface RouteLayer {
        route?: {
          path: string;
          methods: { post?: boolean };
        };
      }
      const routes = (router as { stack: RouteLayer[] }).stack;
      const createRoute = routes.find(
        (r) => r.route && r.route.path === '/sessions' && r.route.methods.post
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

      if (createRoute?.route?.stack?.[0]) {
        await createRoute.route.stack[0].handle(mockReq, mockRes);
      } else {
        throw new Error('Could not find POST /sessions route handler');
      }

      // Should still have repo path but no branch
      expect(mockPtyManager.createSession).toHaveBeenCalledWith(
        ['git', 'log'],
        expect.objectContaining({
          gitRepoPath: '/test/repo',
          gitBranch: undefined,
        })
      );
    });

    it.skip('should pass Git info to terminal spawn request', async () => {
      // The mock is already set up based on our implementation

      // Mock requestTerminalSpawn to simulate successful terminal spawn
      vi.mocked(requestTerminalSpawn).mockResolvedValueOnce({
        success: true,
      });

      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: null,
        isHQMode: false,
        activityMonitor: mockActivityMonitor,
      });

      interface RouteLayer {
        route?: {
          path: string;
          methods: { post?: boolean };
        };
      }
      const routes = (router as { stack: RouteLayer[] }).stack;
      const createRoute = routes.find(
        (r) => r.route && r.route.path === '/sessions' && r.route.methods.post
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

      if (createRoute?.route?.stack?.[0]) {
        await createRoute.route.stack[0].handle(mockReq, mockRes);
      } else {
        throw new Error('Could not find POST /sessions route handler');
      }

      // Verify terminal spawn was called
      expect(requestTerminalSpawn).toHaveBeenCalled();
    });
  });
});
