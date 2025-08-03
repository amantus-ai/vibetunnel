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

      // Should still create the session successfully with both sessionId and createdAt
      expect(mockRes.json).toHaveBeenCalledWith({
        sessionId: 'test-session-123',
        createdAt: expect.any(String),
      });
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

  describe('POST /sessions - Response Format Validation', () => {
    beforeEach(() => {
      // Reset requestTerminalSpawn mock to default (failed spawn)
      vi.mocked(requestTerminalSpawn).mockResolvedValue({
        success: false,
        error: 'Terminal spawn failed in test',
      });

      // Setup mock to return session data
      mockPtyManager.createSession = vi.fn(() => ({
        sessionId: 'session-abc-123',
        sessionInfo: {
          id: 'session-abc-123',
          pid: 12345,
          name: 'Test Session',
          command: ['bash'],
          workingDir: '/test/dir',
        },
      }));
    });

    it('should return CreateSessionResponse format with sessionId and createdAt for web sessions', async () => {
      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: null,
        isHQMode: false,
        activityMonitor: mockActivityMonitor,
      });

      const routes = (
        router as {
          stack: Array<{
            route?: {
              path: string;
              methods: { post?: boolean };
              stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
            };
          }>;
        }
      ).stack;
      const createRoute = routes.find(
        (r) => r.route && r.route.path === '/sessions' && r.route.methods.post
      );

      const mockReq = {
        body: {
          command: ['bash'],
          workingDir: '/test/dir',
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

      // Verify response matches Mac app's CreateSessionResponse expectation
      expect(mockRes.json).toHaveBeenCalledWith({
        sessionId: 'session-abc-123',
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/), // ISO string format
      });
    });

    it('should ensure terminal spawn requests still return CreateSessionResponse format', async () => {
      // Note: Terminal spawn integration is complex and tested elsewhere.
      // This test ensures the fallback path returns the correct response format.

      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: null,
        isHQMode: false,
        activityMonitor: mockActivityMonitor,
      });

      const routes = (
        router as {
          stack: Array<{
            route?: {
              path: string;
              methods: { post?: boolean };
              stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
            };
          }>;
        }
      ).stack;
      const createRoute = routes.find(
        (r) => r.route && r.route.path === '/sessions' && r.route.methods.post
      );

      const mockReq = {
        body: {
          command: ['zsh'],
          workingDir: '/test/dir',
          spawn_terminal: true,
          titleMode: 'dynamic',
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

      // Even when terminal spawn falls back to web session,
      // response must include CreateSessionResponse format
      expect(mockRes.json).toHaveBeenCalledWith({
        sessionId: 'session-abc-123',
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      });
    });

    it('should fallback to web session with correct format when terminal spawn fails', async () => {
      // Mock terminal spawn to fail
      vi.mocked(requestTerminalSpawn).mockResolvedValueOnce({
        success: false,
        error: 'Terminal spawn failed',
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
        router as {
          stack: Array<{
            route?: {
              path: string;
              methods: { post?: boolean };
              stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
            };
          }>;
        }
      ).stack;
      const createRoute = routes.find(
        (r) => r.route && r.route.path === '/sessions' && r.route.methods.post
      );

      const mockReq = {
        body: {
          command: ['zsh'],
          workingDir: '/test/dir',
          spawn_terminal: true,
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

      // Should fallback to web session with correct format
      expect(mockRes.json).toHaveBeenCalledWith({
        sessionId: 'session-abc-123',
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      });
    });

    it('should validate createdAt is a valid ISO string', async () => {
      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: null,
        isHQMode: false,
        activityMonitor: mockActivityMonitor,
      });

      const routes = (
        router as {
          stack: Array<{
            route?: {
              path: string;
              methods: { post?: boolean };
              stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
            };
          }>;
        }
      ).stack;
      const createRoute = routes.find(
        (r) => r.route && r.route.path === '/sessions' && r.route.methods.post
      );

      const mockReq = {
        body: {
          command: ['bash'],
          workingDir: '/test/dir',
        },
      } as Request;

      let capturedResponse: { sessionId: string; createdAt: string };
      const mockRes = {
        json: vi.fn((data) => {
          capturedResponse = data;
        }),
        status: vi.fn().mockReturnThis(),
      } as unknown as Response;

      if (createRoute?.route?.stack?.[0]) {
        await createRoute.route.stack[0].handle(mockReq, mockRes);
      } else {
        throw new Error('Could not find POST /sessions route handler');
      }

      // Verify createdAt can be parsed as a valid Date
      expect(capturedResponse).toBeDefined();
      expect(capturedResponse.createdAt).toBeDefined();
      const parsedDate = new Date(capturedResponse.createdAt);
      expect(parsedDate.toISOString()).toBe(capturedResponse.createdAt);
      expect(parsedDate.getTime()).toBeCloseTo(Date.now(), -2); // Within ~100ms
    });
  });

  describe('POST /sessions - Remote Server Communication', () => {
    let mockRemoteRegistry: {
      getRemote: ReturnType<typeof vi.fn>;
      addSessionToRemote: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockRemoteRegistry = {
        getRemote: vi.fn(),
        addSessionToRemote: vi.fn(),
      };

      // Mock fetch for remote server communication
      global.fetch = vi.fn();
    });

    afterEach(() => {
      vi.resetAllMocks();
    });

    it('should handle remote session creation with new response format (sessionId + createdAt)', async () => {
      // Mock remote registry to return a remote server
      mockRemoteRegistry.getRemote.mockReturnValue({
        id: 'remote-1',
        name: 'Remote Server',
        url: 'https://remote.example.com',
        token: 'test-token',
      });

      // Mock fetch to return new response format
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          sessionId: 'remote-session-123',
          createdAt: '2023-01-01T12:00:00.000Z',
        }),
      } as Response);

      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: mockRemoteRegistry,
        isHQMode: true,
        activityMonitor: mockActivityMonitor,
      });

      const routes = (
        router as {
          stack: Array<{
            route?: {
              path: string;
              methods: { post?: boolean };
              stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
            };
          }>;
        }
      ).stack;
      const createRoute = routes.find(
        (r) => r.route && r.route.path === '/sessions' && r.route.methods.post
      );

      const mockReq = {
        body: {
          command: ['bash'],
          workingDir: '/test/dir',
          remoteId: 'remote-1',
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

      // Verify remote server was called with correct payload
      expect(fetch).toHaveBeenCalledWith(
        'https://remote.example.com/api/sessions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token',
          }),
          body: JSON.stringify({
            command: ['bash'],
            workingDir: '/test/dir',
            // remoteId should NOT be forwarded to avoid recursion
          }),
        })
      );

      // Verify response forwards the complete remote response
      expect(mockRes.json).toHaveBeenCalledWith({
        sessionId: 'remote-session-123',
        createdAt: '2023-01-01T12:00:00.000Z',
      });

      // Verify session was tracked in registry
      expect(mockRemoteRegistry.addSessionToRemote).toHaveBeenCalledWith(
        'remote-1',
        'remote-session-123'
      );
    });

    it('should handle remote session creation with legacy response format (sessionId only)', async () => {
      // Mock remote registry to return a remote server
      mockRemoteRegistry.getRemote.mockReturnValue({
        id: 'remote-1',
        name: 'Legacy Remote Server',
        url: 'https://legacy-remote.example.com',
        token: 'test-token',
      });

      // Mock fetch to return legacy response format (sessionId only)
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          sessionId: 'legacy-session-456',
          // No createdAt field (legacy format)
        }),
      } as Response);

      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: mockRemoteRegistry,
        isHQMode: true,
        activityMonitor: mockActivityMonitor,
      });

      const routes = (
        router as {
          stack: Array<{
            route?: {
              path: string;
              methods: { post?: boolean };
              stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
            };
          }>;
        }
      ).stack;
      const createRoute = routes.find(
        (r) => r.route && r.route.path === '/sessions' && r.route.methods.post
      );

      const mockReq = {
        body: {
          command: ['bash'],
          workingDir: '/test/dir',
          remoteId: 'remote-1',
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

      // Verify response forwards legacy response as-is
      expect(mockRes.json).toHaveBeenCalledWith({
        sessionId: 'legacy-session-456',
        // createdAt will be undefined, which is fine for backward compatibility
      });

      // Verify session was still tracked
      expect(mockRemoteRegistry.addSessionToRemote).toHaveBeenCalledWith(
        'remote-1',
        'legacy-session-456'
      );
    });

    it('should not forward remoteId to prevent recursion', async () => {
      mockRemoteRegistry.getRemote.mockReturnValue({
        id: 'remote-1',
        name: 'Remote Server',
        url: 'https://remote.example.com',
        token: 'test-token',
      });

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ sessionId: 'test-session' }),
      } as Response);

      const router = createSessionRoutes({
        ptyManager: mockPtyManager,
        terminalManager: mockTerminalManager,
        streamWatcher: mockStreamWatcher,
        remoteRegistry: mockRemoteRegistry,
        isHQMode: true,
        activityMonitor: mockActivityMonitor,
      });

      const routes = (
        router as {
          stack: Array<{
            route?: {
              path: string;
              methods: { post?: boolean };
              stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
            };
          }>;
        }
      ).stack;
      const createRoute = routes.find(
        (r) => r.route && r.route.path === '/sessions' && r.route.methods.post
      );

      const mockReq = {
        body: {
          command: ['bash'],
          workingDir: '/test/dir',
          remoteId: 'remote-1',
          spawn_terminal: true,
          cols: 80,
          rows: 24,
          titleMode: 'dynamic',
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

      // Verify that remoteId is NOT included in the forwarded request
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1]?.body as string);

      expect(requestBody).toEqual({
        command: ['bash'],
        workingDir: '/test/dir',
        spawn_terminal: true,
        cols: 80,
        rows: 24,
        titleMode: 'dynamic',
        // remoteId should be excluded to prevent recursion
      });
      expect(requestBody.remoteId).toBeUndefined();
    });
  });
});
