import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Worktree {
  path: string;
  branch: string;
  HEAD: string;
  detached: boolean;
  prunable?: boolean;
  locked?: boolean;
  lockedReason?: string;
}

interface GitError extends Error {
  stderr?: string;
  exitCode?: number;
}

// Create mock functions
const mockExecFile = vi.fn();

// Mock child_process
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

// Mock util
vi.mock('util', () => ({
  promisify: vi.fn(() => mockExecFile),
}));

// Mock git-hooks module
vi.mock('../utils/git-hooks.js', () => ({
  areHooksInstalled: vi.fn().mockResolvedValue(true),
  installGitHooks: vi.fn().mockResolvedValue({ success: true, errors: [] }),
  uninstallGitHooks: vi.fn().mockResolvedValue({ success: true, errors: [] }),
}));

// Mock control unix handler
vi.mock('../websocket/control-unix-handler.js', () => ({
  controlUnixHandler: {
    isMacAppConnected: vi.fn().mockReturnValue(false),
    sendToMac: vi.fn(),
  },
}));

// Import after mocks are set up
const { createWorktreeRoutes } = await import('./worktrees.js');

describe('Worktree Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api', createWorktreeRoutes());

    vi.clearAllMocks();
    mockExecFile.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/worktrees', () => {
    const mockWorktreeListOutput = `worktree /home/user/project
HEAD 1234567890abcdef1234567890abcdef12345678
branch refs/heads/main

worktree /home/user/project-feature-branch
HEAD abcdef1234567890abcdef1234567890abcdef12
branch refs/heads/feature/branch

worktree /home/user/project-detached
HEAD fedcba0987654321fedcba0987654321fedcba09
detached

`;

    it('should list worktrees with stats', async () => {
      // Mock git symbolic-ref for default branch detection
      mockExecFile.mockResolvedValueOnce({
        stdout: 'refs/remotes/origin/main\n',
        stderr: '',
      });

      // Mock git config for follow branch (not set)
      mockExecFile.mockRejectedValueOnce(new Error('Not found'));

      // Mock git worktree list
      mockExecFile.mockResolvedValueOnce({
        stdout: mockWorktreeListOutput,
        stderr: '',
      });

      // Mock stats for feature branch
      mockExecFile.mockResolvedValueOnce({ stdout: '5\n', stderr: '' }); // commits ahead
      mockExecFile.mockResolvedValueOnce({
        stdout: '3 files changed, 20 insertions(+), 5 deletions(-)\n',
        stderr: '',
      }); // diff stat
      mockExecFile.mockResolvedValueOnce({ stdout: 'M file.txt\n', stderr: '' }); // status (has uncommitted)

      // No stats for detached HEAD (it's skipped)

      const response = await request(app)
        .get('/api/worktrees')
        .query({ repoPath: '/home/user/project' });

      expect(response.status).toBe(200);
      expect(response.body.baseBranch).toBe('main');
      // The API now returns all worktrees including the main repository
      expect(response.body.worktrees).toHaveLength(3);

      // Check each worktree

      const mainWorktree = response.body.worktrees.find(
        (w: Worktree) => w.path === '/home/user/project'
      );
      expect(mainWorktree).toBeDefined();
      expect(mainWorktree.branch).toBe('refs/heads/main');
      expect(mainWorktree.detached).toBe(false);

      const featureWorktree = response.body.worktrees.find(
        (w: Worktree) => w.path === '/home/user/project-feature-branch'
      );
      expect(featureWorktree).toBeDefined();
      expect(featureWorktree.branch).toBe('refs/heads/feature/branch');
      expect(featureWorktree.detached).toBe(false);

      const detachedWorktree = response.body.worktrees.find(
        (w: Worktree) => w.path === '/home/user/project-detached'
      );
      expect(detachedWorktree).toBeDefined();
      expect(detachedWorktree.detached).toBe(true);
    });

    it('should handle missing repoPath parameter', async () => {
      const response = await request(app).get('/api/worktrees');
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing');
    });

    it('should fallback to main branch when origin HEAD detection fails', async () => {
      // Mock symbolic-ref failure
      mockExecFile.mockRejectedValueOnce(new Error('Not found'));

      // Mock git rev-parse to check for main branch (succeeds)
      mockExecFile.mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' });

      // Mock git config for follow branch (not set)
      mockExecFile.mockRejectedValueOnce(new Error('Not found'));

      // Mock git worktree list
      mockExecFile.mockResolvedValueOnce({ stdout: mockWorktreeListOutput, stderr: '' });

      // Mock stats for all 3 worktrees (including main)
      for (let i = 0; i < 3; i++) {
        mockExecFile.mockResolvedValueOnce({ stdout: '0\n', stderr: '' });
        mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
        mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      }

      const response = await request(app)
        .get('/api/worktrees')
        .query({ repoPath: '/home/user/project' });

      expect(response.status).toBe(200);
      expect(response.body.baseBranch).toBe('main');
    });

    it('should fallback to master branch when main does not exist', async () => {
      // Mock symbolic-ref failure
      mockExecFile.mockRejectedValueOnce(new Error('Not found'));

      // Mock git rev-parse to check for main branch (fails)
      mockExecFile.mockRejectedValueOnce(new Error('Not found'));

      // Mock git config for follow branch (not set)
      mockExecFile.mockRejectedValueOnce(new Error('Not found'));

      // Mock git worktree list
      mockExecFile.mockResolvedValueOnce({ stdout: mockWorktreeListOutput, stderr: '' });

      // Mock stats for all 3 worktrees (including main)
      for (let i = 0; i < 3; i++) {
        mockExecFile.mockResolvedValueOnce({ stdout: '0\n', stderr: '' });
        mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
        mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      }

      const response = await request(app)
        .get('/api/worktrees')
        .query({ repoPath: '/home/user/project' });

      expect(response.status).toBe(200);
    });
  });

  describe('DELETE /api/worktrees/:branch', () => {
    it('should delete a worktree without uncommitted changes', async () => {
      mockExecFile.mockResolvedValueOnce({
        stdout: `worktree /home/user/project
HEAD abc
branch refs/heads/main

worktree /home/user/project-feature
HEAD def
branch refs/heads/feature

`,
        stderr: '',
      });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' }); // no uncommitted changes
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' }); // successful removal

      const response = await request(app)
        .delete('/api/worktrees/feature')
        .query({ repoPath: '/home/user/project' });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('removed successfully');
    });

    it('should return 409 when worktree has uncommitted changes', async () => {
      mockExecFile.mockResolvedValueOnce({
        stdout: `worktree /home/user/project-feature
HEAD def
branch refs/heads/feature

`,
        stderr: '',
      });
      mockExecFile.mockResolvedValueOnce({ stdout: 'M file.txt\n', stderr: '' }); // has changes

      const response = await request(app)
        .delete('/api/worktrees/feature')
        .query({ repoPath: '/home/user/project' });

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('uncommitted changes');
    });

    it('should force delete when force=true', async () => {
      // Mock worktree list
      mockExecFile.mockResolvedValueOnce({
        stdout: `worktree /home/user/project-feature
HEAD def
branch refs/heads/feature

`,
        stderr: '',
      });
      // Mock removal with force
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const response = await request(app)
        .delete('/api/worktrees/feature')
        .query({ repoPath: '/home/user/project', force: 'true' });

      expect(response.status).toBe(200);
    });

    it('should return 404 when worktree not found', async () => {
      // Mock empty worktree list (no worktrees found)
      mockExecFile.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
      });

      const response = await request(app)
        .delete('/api/worktrees/nonexistent')
        .query({ repoPath: '/home/user/project' });

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/worktrees/prune', () => {
    it('should prune worktree information', async () => {
      mockExecFile.mockResolvedValueOnce({
        stdout: 'Removing worktrees/temp/stale: gitdir file points to non-existent location\n',
        stderr: '',
      });

      const response = await request(app)
        .post('/api/worktrees/prune')
        .send({ repoPath: '/home/user/project' });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Worktree information pruned successfully');
      expect(response.body.output).toContain('temp/stale');
    });

    it('should handle missing repoPath', async () => {
      const response = await request(app).post('/api/worktrees/prune').send({});
      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/worktrees/follow', () => {
    it('should enable follow mode', async () => {
      // Mock worktree list to find the path for the branch
      mockExecFile.mockResolvedValueOnce({
        stdout: `worktree /home/user/project
HEAD abc123
branch refs/heads/main

`,
        stderr: '',
      });

      // Mock setting git config for follow branch
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' }); // config set

      // Mock branch list check
      mockExecFile.mockResolvedValueOnce({ stdout: '* main\n', stderr: '' });

      // Mock checkout
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const response = await request(app).post('/api/worktrees/follow').send({
        repoPath: '/home/user/project',
        branch: 'main',
        enable: true,
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        enabled: true,
        message: 'Follow mode enabled',
        branch: 'main',
      });
    });

    it('should disable follow mode', async () => {
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const response = await request(app).post('/api/worktrees/follow').send({
        repoPath: '/home/user/project',
        branch: 'main',
        enable: false,
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        enabled: false,
        message: 'Follow mode disabled',
      });
    });

    it('should handle config unset when already disabled', async () => {
      const error = new Error('error: key "vibetunnel.followWorktree" not found') as Error & {
        exitCode: number;
        stderr: string;
      };
      error.exitCode = 5;
      error.stderr = 'error: key "vibetunnel.followWorktree" not found';
      mockExecFile.mockRejectedValueOnce(error);

      const response = await request(app).post('/api/worktrees/follow').send({
        repoPath: '/home/user/project',
        branch: 'main',
        enable: false,
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        enabled: false,
        message: 'Follow mode disabled',
      });
    });

    it('should validate request parameters', async () => {
      const response = await request(app).post('/api/worktrees/follow').send({
        repoPath: '/home/user/project',
        branch: 'main',
      });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/worktrees', () => {
    beforeEach(() => {
      mockExecFile.mockReset();
    });

    it('should create a new worktree for an existing branch', async () => {
      const requestBody = {
        repoPath: '/test/repo',
        branch: 'feature-branch',
        path: '/test/worktrees/feature',
      };

      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const response = await request(app).post('/api/worktrees').send(requestBody).expect(200);

      expect(response.body).toEqual({
        message: 'Worktree created successfully',
        worktreePath: '/test/worktrees/feature',
        branch: 'feature-branch',
      });

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['worktree', 'add', '/test/worktrees/feature', 'feature-branch'],
        expect.objectContaining({
          cwd: '/test/repo',
        })
      );
    });

    it('should create a new worktree with a new branch from base branch', async () => {
      const requestBody = {
        repoPath: '/test/repo',
        branch: 'new-feature',
        path: '/test/worktrees/new-feature',
        baseBranch: 'main',
      };

      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const response = await request(app).post('/api/worktrees').send(requestBody).expect(200);

      expect(response.body).toEqual({
        message: 'Worktree created successfully',
        worktreePath: '/test/worktrees/new-feature',
        branch: 'new-feature',
      });

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['worktree', 'add', '-b', 'new-feature', '/test/worktrees/new-feature', 'main'],
        expect.objectContaining({
          cwd: '/test/repo',
        })
      );
    });

    it('should return 400 for missing repoPath', async () => {
      const requestBody = {
        branch: 'feature',
        path: '/test/worktrees/feature',
      };

      const response = await request(app).post('/api/worktrees').send(requestBody).expect(400);

      expect(response.body).toEqual({
        error: 'Missing or invalid repoPath in request body',
      });
    });

    it('should return 400 for missing branch', async () => {
      const requestBody = {
        repoPath: '/test/repo',
        path: '/test/worktrees/feature',
      };

      const response = await request(app).post('/api/worktrees').send(requestBody).expect(400);

      expect(response.body).toEqual({
        error: 'Missing or invalid branch in request body',
      });
    });

    it('should return 400 for missing path', async () => {
      const requestBody = {
        repoPath: '/test/repo',
        branch: 'feature',
      };

      const response = await request(app).post('/api/worktrees').send(requestBody).expect(400);

      expect(response.body).toEqual({
        error: 'Missing or invalid path in request body',
      });
    });

    it('should handle git command failures', async () => {
      const requestBody = {
        repoPath: '/test/repo',
        branch: 'feature',
        path: '/test/worktrees/feature',
      };

      const error = new Error('Command failed');
      (error as GitError).stderr = 'fatal: could not create worktree';
      mockExecFile.mockRejectedValueOnce(error);

      const response = await request(app).post('/api/worktrees').send(requestBody).expect(500);

      expect(response.body).toEqual({
        error: 'Failed to create worktree',
        details: 'fatal: could not create worktree',
      });
    });
  });
});
