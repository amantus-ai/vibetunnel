import express from 'express';
import request from 'supertest';
import { promisify } from 'util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitRoutes } from './git.js';

// Mock child_process.execFile
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

// Mock the promisify function to return our mocked execFile
vi.mock('util', async () => {
  const actual = await vi.importActual('util');
  return {
    ...actual,
    promisify: (fn: any) => {
      if (fn === require('child_process').execFile) {
        return vi.fn();
      }
      return (actual as any).promisify(fn);
    },
  };
});

describe('Git Routes', () => {
  let app: express.Application;
  let mockExecFile: any;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api', createGitRoutes());

    // Get the mocked execFile
    mockExecFile = promisify(require('child_process').execFile);
    vi.clearAllMocks();
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
      const error = new Error('Command failed');
      (error as any).code = 128;
      (error as any).stderr =
        'fatal: not a git repository (or any of the parent directories): .git';
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
      const error = new Error('Command not found');
      (error as any).code = 'ENOENT';
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
      const error = new Error('Unexpected git error');
      (error as any).code = 1;
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
    it('should return 501 not implemented for now', async () => {
      const response = await request(app)
        .post('/api/git/event')
        .send({ repoPath: '/home/user/project' });

      expect(response.status).toBe(501);
      expect(response.body).toEqual({
        error: 'Not implemented yet',
      });
    });
  });
});
