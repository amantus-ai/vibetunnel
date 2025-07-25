import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Create mock functions
const mockExecFile = vi.fn();
const mockCreateSession = vi.fn();
const mockSendControlMessage = vi.fn();
const mockIsMacAppConnected = vi.fn();

// Mock child_process
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

// Mock util.promisify to return appropriate mocks based on the function
vi.mock('util', () => ({
  promisify: vi.fn((fn) => {
    // If it's execFile from child_process, return our mock
    if (fn && fn.name === 'execFile') {
      return mockExecFile;
    }
    // For fs functions, return original promisified versions
    return vi.fn();
  }),
}));

// Mock dependencies
vi.mock('../../server/pty/pty-manager.js', () => ({
  ptyManager: {
    createSession: mockCreateSession,
  },
}));

vi.mock('../../server/websocket/control-unix-handler.js', () => ({
  controlUnixHandler: {
    sendControlMessage: mockSendControlMessage,
    isMacAppConnected: mockIsMacAppConnected,
  },
}));

vi.mock('../../server/services/terminal-manager.js', () => ({
  TerminalManager: vi.fn(),
}));

vi.mock('../../server/services/activity-monitor.js', () => ({
  ActivityMonitor: vi.fn(),
}));

vi.mock('../../server/services/stream-watcher.js', () => ({
  StreamWatcher: vi.fn(),
}));

vi.mock('../../server/services/remote-registry.js', () => ({
  RemoteRegistry: vi.fn(),
}));

vi.mock('../../server/websocket/control-protocol.js', () => ({
  createControlMessage: vi.fn((category: string, action: string, payload: unknown) => ({
    type: 'request',
    category,
    action,
    payload,
    sessionId: (payload as { sessionId?: string })?.sessionId,
  })),
}));

vi.mock('../../server/utils/logger.js', () => ({
  createLogger: () => ({
    log: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  }),
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  fsync: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}));

// Import modules after mocks are set up
const sessionsModule = await import('../../server/routes/sessions.js');

import express from 'express';
import request from 'supertest';

describe('Session Creation with Git Info', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset all mocks to initial state
    mockExecFile.mockReset();
    mockCreateSession.mockReset();
    mockSendControlMessage.mockReset();
    mockIsMacAppConnected.mockReset();
    mockIsMacAppConnected.mockReturnValue(false);

    // Set up Express app
    app = express();
    app.use(express.json());

    const mockTerminalManager = { getTerminalById: vi.fn() };
    const mockActivityMonitor = {};
    const mockStreamWatcher = {};
    const mockRemoteRegistry = null;

    const config = {
      ptyManager: { createSession: mockCreateSession },
      terminalManager: mockTerminalManager,
      streamWatcher: mockStreamWatcher,
      remoteRegistry: mockRemoteRegistry,
      isHQMode: false,
      activityMonitor: mockActivityMonitor,
    };

    app.use('/api', sessionsModule.createSessionRoutes(config));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Git Info Detection', () => {
    it.skip('should detect Git repository and branch information - git detection removed from session creation', async () => {
      // Mock Git commands
      mockExecFile
        .mockResolvedValueOnce({
          stdout: '/home/user/project\n',
          stderr: '',
        }) // rev-parse --show-toplevel
        .mockResolvedValueOnce({
          stdout: 'main\n',
          stderr: '',
        }); // branch --show-current

      // Mock PTY manager response
      mockCreateSession.mockResolvedValue({
        sessionId: 'test-session-123',
        sessionInfo: {
          id: 'test-session-123',
          pty: {},
        },
      });

      const response = await request(app)
        .post('/api/sessions')
        .send({
          command: ['bash'],
          workingDir: '/home/user/project/src',
          name: 'Test Session',
        });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        sessionId: 'test-session-123',
      });

      // Verify Git detection was performed
      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['rev-parse', '--show-toplevel'],
        expect.objectContaining({
          cwd: '/home/user/project/src',
        })
      );

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['branch', '--show-current'],
        expect.objectContaining({
          cwd: '/home/user/project/src',
        })
      );

      // Verify session was created with Git info
      expect(mockCreateSession).toHaveBeenCalledWith(
        ['bash'],
        expect.objectContaining({
          gitRepoPath: '/home/user/project',
          gitBranch: 'main',
        })
      );
    });

    it.skip('should handle detached HEAD state - git detection removed from session creation', async () => {
      // Mock Git commands
      mockExecFile
        .mockResolvedValueOnce({
          stdout: '/home/user/project\n',
          stderr: '',
        }) // rev-parse --show-toplevel
        .mockResolvedValueOnce({
          stdout: '\n', // Empty output for detached HEAD
          stderr: '',
        }); // branch --show-current

      mockCreateSession.mockResolvedValue({
        sessionId: 'test-session-456',
        sessionInfo: {
          id: 'test-session-456',
          pty: {},
        },
      });

      const response = await request(app)
        .post('/api/sessions')
        .send({
          command: ['vim', 'README.md'],
          workingDir: '/home/user/project',
        });

      expect(response.status).toBe(200);

      // In detached HEAD, gitBranch should be empty
      expect(mockCreateSession).toHaveBeenCalledWith(
        ['vim', 'README.md'],
        expect.objectContaining({
          gitRepoPath: '/home/user/project',
          gitBranch: '', // Empty branch for detached HEAD
        })
      );
    });

    it('should handle non-Git directories', async () => {
      // Mock Git command failure (not a git repo)
      const error = new Error('Not a git repository') as Error & { stderr?: string };
      error.stderr = 'fatal: not a git repository';
      mockExecFile.mockRejectedValueOnce(error);

      mockCreateSession.mockResolvedValue({
        sessionId: 'test-session-789',
        sessionInfo: {
          id: 'test-session-789',
          pty: {},
        },
      });

      const response = await request(app)
        .post('/api/sessions')
        .send({
          command: ['python3'],
          workingDir: '/tmp/scratch',
        });

      expect(response.status).toBe(200);

      // Verify session was created without Git info
      expect(mockCreateSession).toHaveBeenCalledWith(
        ['python3'],
        expect.objectContaining({
          gitRepoPath: undefined,
          gitBranch: undefined,
        })
      );
    });

    it('should handle Git command errors gracefully', async () => {
      // Mock unexpected Git error
      const error = new Error('Git command failed');
      mockExecFile.mockRejectedValueOnce(error);

      mockCreateSession.mockResolvedValue({
        sessionId: 'test-session-error',
        sessionInfo: {
          id: 'test-session-error',
          pty: {},
        },
      });

      const response = await request(app)
        .post('/api/sessions')
        .send({
          command: ['node'],
          workingDir: '/home/user/app',
        });

      expect(response.status).toBe(200);

      // Verify session was still created
      expect(mockCreateSession).toHaveBeenCalled();
    });
  });

  describe('Terminal Spawn with Git Info', () => {
    it.skip('should pass Git info to Mac app terminal spawn - git detection removed from session creation', async () => {
      mockIsMacAppConnected.mockReturnValue(true);
      mockSendControlMessage.mockResolvedValue({
        payload: {
          success: true,
          sessionId: 'mac-session-123',
        },
      });

      // Mock Git commands
      mockExecFile
        .mockResolvedValueOnce({
          stdout: '/Users/dev/myapp\n',
          stderr: '',
        })
        .mockResolvedValueOnce({
          stdout: 'feature/new-ui\n',
          stderr: '',
        });

      const response = await request(app)
        .post('/api/sessions')
        .send({
          command: ['zsh'],
          workingDir: '/Users/dev/myapp/src',
          spawn_terminal: true,
        });

      expect(response.status).toBe(200);
      expect(response.body.sessionId).toBeDefined();
      expect(response.body.message).toBe('Terminal spawn requested');

      // Verify control message included Git info
      expect(mockSendControlMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            gitRepoPath: '/Users/dev/myapp',
            gitBranch: 'feature/new-ui',
          }),
        })
      );
    });

    it('should handle Mac app not connected for terminal spawn', async () => {
      mockIsMacAppConnected.mockReturnValue(false);
      mockSendControlMessage.mockResolvedValue(null);

      // Mock PTY manager response for fallback
      mockCreateSession.mockResolvedValue({
        sessionId: 'test-session-fallback',
        sessionInfo: {
          id: 'test-session-fallback',
          pty: {},
        },
      });

      const response = await request(app)
        .post('/api/sessions')
        .send({
          command: ['bash'],
          workingDir: '/home/user/project',
          spawn_terminal: true,
        });

      // Should fall back to normal web session creation
      expect(response.status).toBe(200);
      expect(response.body.sessionId).toBe('test-session-fallback');
    });
  });

  describe('Session Name Generation with Git', () => {
    it.skip('should include Git branch in dynamic title mode - git detection removed from session creation', async () => {
      // Mock Git commands
      mockExecFile
        .mockResolvedValueOnce({
          stdout: '/home/user/project\n',
          stderr: '',
        })
        .mockResolvedValueOnce({
          stdout: 'develop\n',
          stderr: '',
        });

      mockCreateSession.mockResolvedValue({
        sessionId: 'dynamic-title-session',
        sessionInfo: {
          id: 'dynamic-title-session',
          pty: {},
        },
      });

      const response = await request(app)
        .post('/api/sessions')
        .send({
          command: ['node', 'app.js'],
          workingDir: '/home/user/project',
          titleMode: 'dynamic',
        });

      expect(response.status).toBe(200);

      // Verify session was created with title mode
      expect(mockCreateSession).toHaveBeenCalledWith(
        ['node', 'app.js'],
        expect.objectContaining({
          titleMode: 'dynamic',
          gitRepoPath: '/home/user/project',
          gitBranch: 'develop',
        })
      );
    });
  });
});
