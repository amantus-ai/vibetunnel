import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  installGitHooks: vi.fn().mockResolvedValue([]),
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

      // Mock git worktree list
      mockExecFile.mockResolvedValueOnce({
        stdout: mockWorktreeListOutput,
        stderr: '',
      });

      // Mock stats for main branch (no commits ahead)
      mockExecFile.mockResolvedValueOnce({ stdout: '0\n', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      // Mock stats for feature branch
      mockExecFile.mockResolvedValueOnce({ stdout: '5\n', stderr: '' }); // commits ahead
      mockExecFile.mockResolvedValueOnce({
        stdout: '3 files changed, 20 insertions(+), 5 deletions(-)\n',
        stderr: '',
      });
      mockExecFile.mockResolvedValueOnce({ stdout: 'M file.txt\n', stderr: '' }); // uncommitted

      const response = await request(app)
        .get('/api/worktrees')
        .query({ repoPath: '/home/user/project' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        baseBranch: 'main',
        worktrees: [
          {
            path: '/home/user/project',
            branch: 'refs/heads/main',
            HEAD: '1234567890abcdef1234567890abcdef12345678',
            detached: false,
            commitsAhead: 0,
            filesChanged: 0,
            insertions: 0,
            deletions: 0,
            hasUncommittedChanges: false,
          },
          {
            path: '/home/user/project-feature-branch',
            branch: 'refs/heads/feature/branch',
            HEAD: 'abcdef1234567890abcdef1234567890abcdef12',
            detached: false,
            commitsAhead: 5,
            filesChanged: 3,
            insertions: 20,
            deletions: 5,
            hasUncommittedChanges: true,
          },
          {
            path: '/home/user/project-detached',
            HEAD: 'fedcba0987654321fedcba0987654321fedcba09',
            detached: true,
          },
        ],
      });
    });

    it('should handle missing repoPath parameter', async () => {
      const response = await request(app).get('/api/worktrees');
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing');
    });

    it('should fallback to main branch when origin HEAD detection fails', async () => {
      mockExecFile.mockRejectedValueOnce(new Error('Not found'));
      mockExecFile.mockResolvedValueOnce({ stdout: mockWorktreeListOutput, stderr: '' });

      // Mock stats for all worktrees
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

      // Mock git worktree list
      mockExecFile.mockResolvedValueOnce({ stdout: mockWorktreeListOutput, stderr: '' });

      // Mock stats for all worktrees
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
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const response = await request(app)
        .delete('/api/worktrees/feature')
        .query({ repoPath: '/home/user/project', force: 'true' });

      expect(response.status).toBe(200);
    });

    it('should return 404 when worktree not found', async () => {
      const error = new Error("fatal: 'nonexistent' is not a working tree");
      mockExecFile.mockRejectedValueOnce(error);

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
      expect(response.body.pruned).toContain('temp/stale');
    });

    it('should handle missing repoPath', async () => {
      const response = await request(app).post('/api/worktrees/prune').send({});
      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/worktrees/switch', () => {
    it('should switch branch and enable follow mode', async () => {
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' }); // checkout
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' }); // config

      const response = await request(app).post('/api/worktrees/switch').send({
        repoPath: '/home/user/project',
        branch: 'develop',
        enableFollowMode: true,
      });

      expect(response.status).toBe(200);
      expect(response.body.branch).toBe('develop');
      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['checkout', 'develop'],
        expect.objectContaining({ cwd: '/home/user/project' })
      );
      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['config', 'vibetunnel.followMode', 'true'],
        expect.objectContaining({ cwd: '/home/user/project' })
      );
    });

    it('should handle missing parameters', async () => {
      const response = await request(app).post('/api/worktrees/switch').send({});
      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/worktrees/follow', () => {
    it('should enable follow mode', async () => {
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' }); // config
      // Mock Git hook checks
      mockExecFile.mockResolvedValueOnce({
        stdout: '#!/bin/sh\n# VibeTunnel post-commit hook',
        stderr: '',
      }); // post-commit exists
      mockExecFile.mockResolvedValueOnce({
        stdout: '#!/bin/sh\n# VibeTunnel post-checkout hook',
        stderr: '',
      }); // post-checkout exists

      const response = await request(app).post('/api/worktrees/follow').send({
        repoPath: '/home/user/project',
        enabled: true,
      });

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(true);
    });

    it('should disable follow mode', async () => {
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const response = await request(app).post('/api/worktrees/follow').send({
        repoPath: '/home/user/project',
        enabled: false,
      });

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(false);
    });

    it('should handle config unset when already disabled', async () => {
      const error = new Error('error: key "vibetunnel.followMode" not found');
      mockExecFile.mockRejectedValueOnce(error);

      const response = await request(app).post('/api/worktrees/follow').send({
        repoPath: '/home/user/project',
        enabled: false,
      });

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(false);
    });

    it('should validate request parameters', async () => {
      const response = await request(app).post('/api/worktrees/follow').send({
        repoPath: '/home/user/project',
      });

      expect(response.status).toBe(400);
    });
  });
});
