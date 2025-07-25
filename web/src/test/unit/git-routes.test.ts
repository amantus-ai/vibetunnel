import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock promisify to return a function that we can control
let mockExecFile: ReturnType<typeof vi.fn>;

vi.mock('util', () => {
  return {
    promisify: vi.fn(() => {
      // Return a function that can be mocked later
      return (...args: unknown[]) => {
        if (mockExecFile) {
          return mockExecFile(...args);
        }
        throw new Error('mockExecFile not initialized');
      };
    }),
  };
});

vi.mock('../../server/pty/session-manager.js', () => ({
  SessionManager: vi.fn(() => ({
    listSessions: vi.fn().mockReturnValue([]),
    updateSessionName: vi.fn(),
  })),
}));

vi.mock('../../server/websocket/control-unix-handler.js', () => ({
  controlUnixHandler: {
    isMacAppConnected: vi.fn().mockReturnValue(false),
    sendToMac: vi.fn(),
  },
}));

vi.mock('../../server/websocket/control-protocol.js', () => ({
  createControlEvent: vi.fn((category: string, action: string, payload: unknown) => ({
    type: 'event',
    category,
    action,
    payload,
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

describe('Git Routes', () => {
  let app: express.Application;
  let createGitRoutes: typeof import('../../server/routes/git.js').createGitRoutes;
  let SessionManager: typeof import('../../server/pty/session-manager.js').SessionManager;
  let controlUnixHandler: typeof import('../../server/websocket/control-unix-handler.js').controlUnixHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockExecFile = vi.fn();

    // Import after mocks are set up
    const gitModule = await import('../../server/routes/git.js');
    createGitRoutes = gitModule.createGitRoutes;

    const sessionModule = await import('../../server/pty/session-manager.js');
    SessionManager = sessionModule.SessionManager;

    const controlModule = await import('../../server/websocket/control-unix-handler.js');
    controlUnixHandler = controlModule.controlUnixHandler;

    app = express();
    app.use(express.json());
    app.use('/api', createGitRoutes());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/git/repo-info', () => {
    it('should return isGitRepo: true with repo path when in a git repository', async () => {
      mockExecFile.mockResolvedValueOnce({
        stdout: '/home/user/my-project\n',
        stderr: '',
      });

      const response = await request(app)
        .get('/api/git/repo-info')
        .query({ path: '/home/user/my-project/src' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        isGitRepo: true,
        repoPath: '/home/user/my-project',
      });

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['rev-parse', '--show-toplevel'],
        expect.objectContaining({
          cwd: expect.stringContaining('my-project'),
          timeout: 5000,
          maxBuffer: 1024 * 1024,
          env: expect.objectContaining({ GIT_TERMINAL_PROMPT: '0' }),
        })
      );
    });

    it('should return isGitRepo: false when not in a git repository', async () => {
      const error = new Error('Command failed') as Error & { code?: number; stderr?: string };
      error.code = 128;
      error.stderr = 'fatal: not a git repository (or any of the parent directories): .git';
      mockExecFile.mockRejectedValueOnce(error);

      const response = await request(app)
        .get('/api/git/repo-info')
        .query({ path: '/tmp/not-a-repo' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        isGitRepo: false,
      });
    });

    it('should return isGitRepo: false when git command is not found', async () => {
      const error = new Error('Command not found') as Error & { code?: string };
      error.code = 'ENOENT';
      mockExecFile.mockRejectedValueOnce(error);

      const response = await request(app)
        .get('/api/git/repo-info')
        .query({ path: '/home/user/project' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        isGitRepo: false,
      });
    });

    it('should return 400 when path parameter is missing', async () => {
      const response = await request(app).get('/api/git/repo-info');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Missing or invalid path parameter',
      });
    });

    it('should return 400 when path parameter is not a string', async () => {
      const response = await request(app)
        .get('/api/git/repo-info')
        .query({ path: ['array', 'value'] });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Missing or invalid path parameter',
      });
    });

    it('should handle unexpected git errors', async () => {
      const error = new Error('Unexpected git error') as Error & { code?: number };
      error.code = 1;
      mockExecFile.mockRejectedValueOnce(error);

      const response = await request(app)
        .get('/api/git/repo-info')
        .query({ path: '/home/user/project' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'Failed to check git repository info',
      });
    });

    it('should handle paths with spaces', async () => {
      mockExecFile.mockResolvedValueOnce({
        stdout: '/home/user/my project\n',
        stderr: '',
      });

      const response = await request(app)
        .get('/api/git/repo-info')
        .query({ path: '/home/user/my project/src' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        isGitRepo: true,
        repoPath: '/home/user/my project',
      });
    });
  });

  describe('POST /api/git/event', () => {
    let mockSessionManagerInstance: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Reset mocks for each test
      mockSessionManagerInstance = {
        listSessions: vi.fn().mockReturnValue([]),
        updateSessionName: vi.fn(),
      };

      // Make SessionManager constructor return our mock instance
      (SessionManager as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        () => mockSessionManagerInstance
      );
    });

    it('should handle git event with repository lock', async () => {
      // Set up Git command mocks
      mockExecFile
        .mockResolvedValueOnce({ stdout: '/home/user/project/.git\n', stderr: '' }) // git dir check
        .mockRejectedValueOnce(new Error('Key not found')) // follow worktree check (not set)
        .mockResolvedValueOnce({ stdout: 'main\n', stderr: '' }); // current branch

      const response = await request(app).post('/api/git/event').send({
        repoPath: '/home/user/project',
        branch: 'feature/new',
        event: 'checkout',
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        repoPath: expect.stringContaining('project'),
        sessionsUpdated: 0,
        followMode: false,
      });
    });

    it('should update session titles for sessions in repository', async () => {
      // Mock sessions in the repository
      mockSessionManagerInstance.listSessions.mockReturnValue([
        {
          id: 'session1',
          name: 'Terminal',
          workingDir: '/home/user/project/src',
        },
        {
          id: 'session2',
          name: 'Editor',
          workingDir: '/home/user/project',
        },
        {
          id: 'session3',
          name: 'Other',
          workingDir: '/home/user/other-project',
        },
      ]);

      mockExecFile
        .mockResolvedValueOnce({ stdout: '/home/user/project/.git\n', stderr: '' }) // git dir check
        .mockRejectedValueOnce(new Error('Key not found')) // follow worktree check (not set)
        .mockResolvedValueOnce({ stdout: 'develop\n', stderr: '' }); // current branch

      const response = await request(app).post('/api/git/event').send({
        repoPath: '/home/user/project',
        branch: 'main',
        event: 'pull',
      });

      expect(response.status).toBe(200);
      expect(response.body.sessionsUpdated).toBe(2);

      // Verify only sessions in the repo were updated
      expect(mockSessionManagerInstance.updateSessionName).toHaveBeenCalledTimes(2);
      expect(mockSessionManagerInstance.updateSessionName).toHaveBeenCalledWith(
        'session1',
        'Terminal [pull: main]'
      );
      expect(mockSessionManagerInstance.updateSessionName).toHaveBeenCalledWith(
        'session2',
        'Editor [pull: main]'
      );
    });

    it('should handle follow mode sync when branches have not diverged', async () => {
      // Mock git dir to simulate non-worktree (main repo)
      mockExecFile
        .mockResolvedValueOnce({ stdout: '/home/user/project/.git\n', stderr: '' }) // git dir check
        .mockResolvedValueOnce({ stdout: '/home/user/project-worktree\n', stderr: '' }) // follow worktree config
        .mockResolvedValueOnce({ stdout: 'develop\n', stderr: '' }); // current branch

      const response = await request(app).post('/api/git/event').send({
        repoPath: '/home/user/project',
        branch: 'main',
        event: 'checkout',
      });

      expect(response.status).toBe(200);
      expect(response.body.followMode).toBe(true);
    });

    it('should handle when follow mode is not configured', async () => {
      // Mock git dir to simulate non-worktree (main repo)
      mockExecFile
        .mockResolvedValueOnce({ stdout: '/home/user/project/.git\n', stderr: '' }) // git dir check
        .mockRejectedValueOnce(new Error('Key not found')) // follow worktree config not set
        .mockResolvedValueOnce({ stdout: 'develop\n', stderr: '' }); // current branch

      const response = await request(app).post('/api/git/event').send({
        repoPath: '/home/user/project',
        branch: 'main',
        event: 'checkout',
      });

      expect(response.status).toBe(200);
      expect(response.body.followMode).toBe(false);
    });

    it('should send notification to Mac app when connected', async () => {
      (controlUnixHandler.isMacAppConnected as ReturnType<typeof vi.fn>).mockReturnValue(true);

      mockExecFile
        .mockResolvedValueOnce({ stdout: '/home/user/project/.git\n', stderr: '' }) // git dir check
        .mockRejectedValueOnce(new Error('Key not found')) // follow worktree check (not set)
        .mockResolvedValueOnce({ stdout: 'main\n', stderr: '' }); // current branch

      const response = await request(app).post('/api/git/event').send({
        repoPath: '/home/user/project',
        branch: 'feature',
        event: 'merge',
      });

      expect(response.status).toBe(200);
      expect(controlUnixHandler.sendToMac).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'event',
          category: 'git',
          action: 'repository-changed',
          payload: expect.objectContaining({
            type: 'git-event',
            repoPath: expect.stringContaining('project'),
            branch: 'feature',
            event: 'merge',
            followMode: false,
            sessionsUpdated: [],
          }),
        })
      );
    });

    it('should handle concurrent requests with locking', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '/home/user/project/.git\n', stderr: '' }) // first request - git dir
        .mockRejectedValueOnce(new Error('Key not found')) // first request - no follow worktree
        .mockResolvedValueOnce({ stdout: 'main\n', stderr: '' }) // first request - current branch
        .mockResolvedValueOnce({ stdout: '/home/user/project/.git\n', stderr: '' }) // second request - git dir
        .mockRejectedValueOnce(new Error('Key not found')) // second request - no follow worktree
        .mockResolvedValueOnce({ stdout: 'main\n', stderr: '' }); // second request - current branch

      // Send two concurrent requests
      const [response1, response2] = await Promise.all([
        request(app).post('/api/git/event').send({ repoPath: '/home/user/project', event: 'pull' }),
        request(app).post('/api/git/event').send({ repoPath: '/home/user/project', event: 'push' }),
      ]);

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      expect(response1.body.success).toBe(true);
      expect(response2.body.success).toBe(true);
    });

    it('should return 400 when repoPath is missing', async () => {
      const response = await request(app).post('/api/git/event').send({ branch: 'main' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Missing or invalid repoPath parameter',
      });
    });

    it('should handle git command errors gracefully', async () => {
      const error = new Error('Git command failed');
      mockExecFile.mockRejectedValueOnce(error);

      const response = await request(app)
        .post('/api/git/event')
        .send({ repoPath: '/home/user/project' });

      // Should still succeed even if git command fails
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        repoPath: expect.stringContaining('project'),
        sessionsUpdated: 0,
      });
    });

    it('should handle session update errors gracefully', async () => {
      mockSessionManagerInstance.listSessions.mockReturnValue([
        {
          id: 'session1',
          name: 'Terminal',
          workingDir: '/home/user/project',
        },
      ]);

      mockSessionManagerInstance.updateSessionName.mockImplementation(() => {
        throw new Error('Failed to update session');
      });

      mockExecFile
        .mockRejectedValueOnce(new Error('Key not found')) // follow branch check (not set)
        .mockResolvedValueOnce({ stdout: 'main\n', stderr: '' });

      const response = await request(app)
        .post('/api/git/event')
        .send({ repoPath: '/home/user/project' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.sessionsUpdated).toBe(0); // No sessions updated due to error
    });
  });
});
