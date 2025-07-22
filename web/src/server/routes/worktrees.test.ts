import express from 'express';
import request from 'supertest';
import { promisify } from 'util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorktreeRoutes } from './worktrees.js';

// Mock child_process.execFile
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

// Mock the promisify function to return our mocked execFile
vi.mock('util', async () => {
  const actual = await vi.importActual('util');
  return {
    ...actual,
    promisify: (fn: unknown) => {
      if (fn === require('child_process').execFile) {
        return vi.fn();
      }
      return (actual as typeof import('util')).promisify(fn as (...args: unknown[]) => void);
    },
  };
});

describe('Worktree Routes', () => {
  let app: express.Application;
  let mockExecFile: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api', createWorktreeRoutes());

    // Get the mocked execFile
    mockExecFile = promisify(require('child_process').execFile);
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
            branch: 'HEAD',
            HEAD: 'fedcba0987654321fedcba0987654321fedcba09',
            detached: true,
          },
        ],
      });
    });

    it('should handle missing repoPath parameter', async () => {
      const response = await request(app).get('/api/worktrees');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Missing or invalid repoPath parameter',
      });
    });

    it('should fallback to main branch when origin HEAD detection fails', async () => {
      // Mock failed symbolic-ref
      mockExecFile.mockRejectedValueOnce(new Error('Not found'));

      // Mock successful main branch check
      mockExecFile.mockResolvedValueOnce({ stdout: 'main\n', stderr: '' });

      // Mock worktree list
      mockExecFile.mockResolvedValueOnce({
        stdout: 'worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n\n',
        stderr: '',
      });

      // Mock empty stats
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      const response = await request(app)
        .get('/api/worktrees')
        .query({ repoPath: '/home/user/project' });

      expect(response.status).toBe(200);
      expect(response.body.baseBranch).toBe('main');
    });

    it('should fallback to master branch when main does not exist', async () => {
      // Mock failed symbolic-ref
      mockExecFile.mockRejectedValueOnce(new Error('Not found'));

      // Mock failed main branch check
      mockExecFile.mockRejectedValueOnce(new Error('Not found'));

      // Mock worktree list
      mockExecFile.mockResolvedValueOnce({
        stdout: 'worktree /home/user/project\nHEAD abc123\nbranch refs/heads/master\n\n',
        stderr: '',
      });

      // Mock empty stats
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      const response = await request(app)
        .get('/api/worktrees')
        .query({ repoPath: '/home/user/project' });

      expect(response.status).toBe(200);
      expect(response.body.baseBranch).toBe('master');
    });
  });

  describe('DELETE /api/worktrees/:branch', () => {
    const mockWorktreeListForDelete = `worktree /home/user/project
HEAD 1234567890abcdef1234567890abcdef12345678
branch refs/heads/main

worktree /home/user/project-feature-branch
HEAD abcdef1234567890abcdef1234567890abcdef12
branch refs/heads/feature/branch

`;

    it('should delete a worktree without uncommitted changes', async () => {
      // Mock worktree list
      mockExecFile.mockResolvedValueOnce({
        stdout: mockWorktreeListForDelete,
        stderr: '',
      });

      // Mock status check - no changes
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      // Mock worktree remove
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const response = await request(app)
        .delete('/api/worktrees/refs%2Fheads%2Ffeature%2Fbranch')
        .query({ repoPath: '/home/user/project' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Worktree removed successfully',
        removedPath: '/home/user/project-feature-branch',
      });

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['worktree', 'remove', '/home/user/project-feature-branch'],
        expect.any(Object)
      );
    });

    it('should return 409 when worktree has uncommitted changes', async () => {
      // Mock worktree list
      mockExecFile.mockResolvedValueOnce({
        stdout: mockWorktreeListForDelete,
        stderr: '',
      });

      // Mock status check - has changes
      mockExecFile.mockResolvedValueOnce({ stdout: 'M file.txt\n', stderr: '' });

      const response = await request(app)
        .delete('/api/worktrees/refs%2Fheads%2Ffeature%2Fbranch')
        .query({ repoPath: '/home/user/project' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Worktree has uncommitted changes',
        worktreePath: '/home/user/project-feature-branch',
      });
    });

    it('should force delete when force=true', async () => {
      // Mock worktree list
      mockExecFile.mockResolvedValueOnce({
        stdout: mockWorktreeListForDelete,
        stderr: '',
      });

      // Mock worktree remove with force
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const response = await request(app)
        .delete('/api/worktrees/refs%2Fheads%2Ffeature%2Fbranch')
        .query({ repoPath: '/home/user/project', force: 'true' });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Worktree removed successfully');

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['worktree', 'remove', '--force', '/home/user/project-feature-branch'],
        expect.any(Object)
      );
    });

    it('should return 404 when worktree not found', async () => {
      // Mock worktree list without the requested branch
      mockExecFile.mockResolvedValueOnce({
        stdout: 'worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n\n',
        stderr: '',
      });

      const response = await request(app)
        .delete('/api/worktrees/refs%2Fheads%2Fnonexistent')
        .query({ repoPath: '/home/user/project' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: "Worktree for branch 'refs/heads/nonexistent' not found",
      });
    });
  });

  describe('POST /api/worktrees/prune', () => {
    it('should prune worktree information', async () => {
      mockExecFile.mockResolvedValueOnce({
        stdout: 'Pruned worktree information\n',
        stderr: '',
      });

      const response = await request(app)
        .post('/api/worktrees/prune')
        .send({ repoPath: '/home/user/project' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Worktree information pruned successfully',
        output: 'Pruned worktree information\n',
      });

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['worktree', 'prune'],
        expect.objectContaining({ cwd: expect.stringContaining('project') })
      );
    });

    it('should handle missing repoPath', async () => {
      const response = await request(app).post('/api/worktrees/prune').send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Missing or invalid repoPath in request body',
      });
    });
  });

  describe('POST /api/worktrees/switch', () => {
    it('should switch branch and enable follow mode', async () => {
      // Mock checkout
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      // Mock config set
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const response = await request(app)
        .post('/api/worktrees/switch')
        .send({ repoPath: '/home/user/project', branch: 'feature/new' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Switched to branch and enabled follow mode',
        branch: 'feature/new',
      });

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['checkout', 'feature/new'],
        expect.any(Object)
      );

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['config', '--local', 'vibetunnel.followBranch', 'feature/new'],
        expect.any(Object)
      );
    });

    it('should handle missing parameters', async () => {
      const response1 = await request(app)
        .post('/api/worktrees/switch')
        .send({ branch: 'feature' });

      expect(response1.status).toBe(400);
      expect(response1.body.error).toContain('repoPath');

      const response2 = await request(app)
        .post('/api/worktrees/switch')
        .send({ repoPath: '/path' });

      expect(response2.status).toBe(400);
      expect(response2.body.error).toContain('branch');
    });
  });

  describe('POST /api/worktrees/follow', () => {
    it('should enable follow mode', async () => {
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const response = await request(app).post('/api/worktrees/follow').send({
        repoPath: '/home/user/project',
        branch: 'feature/branch',
        enable: true,
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Follow mode enabled',
        branch: 'feature/branch',
      });

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['config', '--local', 'vibetunnel.followBranch', 'feature/branch'],
        expect.any(Object)
      );
    });

    it('should disable follow mode', async () => {
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const response = await request(app).post('/api/worktrees/follow').send({
        repoPath: '/home/user/project',
        branch: 'feature/branch',
        enable: false,
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Follow mode disabled',
      });

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['config', '--local', '--unset', 'vibetunnel.followBranch'],
        expect.any(Object)
      );
    });

    it('should handle config unset when already disabled', async () => {
      const error = new Error('Config not found') as Error & { exitCode: number };
      error.exitCode = 5;
      mockExecFile.mockRejectedValueOnce(error);

      const response = await request(app).post('/api/worktrees/follow').send({
        repoPath: '/home/user/project',
        branch: 'feature/branch',
        enable: false,
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Follow mode disabled',
      });
    });

    it('should validate request parameters', async () => {
      const response = await request(app).post('/api/worktrees/follow').send({ repoPath: '/path' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('branch');

      const response2 = await request(app)
        .post('/api/worktrees/follow')
        .send({ repoPath: '/path', branch: 'main' });

      expect(response2.status).toBe(400);
      expect(response2.body.error).toContain('enable');
    });
  });
});
