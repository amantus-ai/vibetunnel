import * as fs from 'fs/promises';
import * as path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createStandardTestRepo, type GitTestRepo } from '../helpers/git-test-helper.js';
import { SessionTestHelper } from '../helpers/session-test-helper.js';
import { createTestServer } from '../helpers/test-server.js';

describe('Worktree Workflows Integration Tests', () => {
  let testServer: ReturnType<typeof createTestServer>;
  let gitRepo: GitTestRepo;
  let sessionHelper: SessionTestHelper;
  const createdSessionIds: string[] = [];

  beforeAll(async () => {
    // Create test repository
    gitRepo = await createStandardTestRepo();

    // Create test server with all services properly initialized
    testServer = await createTestServer({
      includeRoutes: {
        sessions: true,
        worktrees: true,
        git: true,
        config: false,
      },
    });

    // Initialize session helper
    sessionHelper = new SessionTestHelper(testServer.ptyManager);
  });

  afterAll(async () => {
    // Kill only sessions created by this test
    await sessionHelper.killTrackedSessions();

    // Clean up any remaining sessions that were created via API
    for (const sessionId of createdSessionIds) {
      try {
        await testServer.ptyManager.killSession(sessionId);
      } catch (_error) {
        // Session might already be dead
      }
    }

    // Stop services (without killing all sessions)

    // Clean up repository
    await gitRepo.cleanup();
  });

  beforeEach(async () => {
    // Clean up any uncommitted changes
    try {
      await gitRepo.gitExec(['checkout', '.']);
      await gitRepo.gitExec(['clean', '-fd']);
    } catch {
      // Ignore errors
    }
  });

  describe('Worktree Management', () => {
    it('should list worktrees with full metadata', async () => {
      const response = await request(testServer.app)
        .get('/api/worktrees')
        .query({ repoPath: gitRepo.repoPath });

      expect(response.status).toBe(200);
      expect(response.body.worktrees).toBeDefined();
      expect(response.body.worktrees.length).toBeGreaterThan(0);

      // Find main worktree - it's the one where path matches repo path
      const mainWorktree = response.body.worktrees.find((w: { path: string }) => {
        // Handle macOS /tmp symlink
        const normalizedWorktreePath = w.path.replace(/^\/private/, '');
        const normalizedRepoPath = gitRepo.repoPath.replace(/^\/private/, '');
        return normalizedWorktreePath === normalizedRepoPath;
      });
      expect(mainWorktree).toBeDefined();
      expect(mainWorktree.branch).toBe('refs/heads/main');
      // Handle macOS /tmp symlink
      const normalizedPath = mainWorktree.path.replace(/^\/private/, '');
      const normalizedRepoPath = gitRepo.repoPath.replace(/^\/private/, '');
      expect(normalizedPath).toBe(normalizedRepoPath);

      // Find feature worktree
      const featureWorktree = response.body.worktrees.find(
        (w: { branch: string; path: string }) =>
          w.branch.includes('feature/test-feature') && w.path !== mainWorktree.path
      );
      expect(featureWorktree).toBeDefined();
      expect(featureWorktree.path).toContain('worktree-feature-test-feature');
    });

    it('should delete worktree', async () => {
      // Create a temporary worktree to delete
      const tempBranch = 'temp/delete-test';
      await gitRepo.gitExec(['checkout', '-b', tempBranch]);
      await gitRepo.gitExec(['checkout', 'main']);

      const worktreePath = path.join(gitRepo.tmpDir, 'temp-worktree');
      await gitRepo.gitExec(['worktree', 'add', worktreePath, tempBranch]);

      // Delete the worktree
      const deleteResponse = await request(testServer.app)
        .delete(`/api/worktrees/${encodeURIComponent(tempBranch)}`)
        .query({ repoPath: gitRepo.repoPath });

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.success).toBe(true);

      // Verify it was deleted
      const { stdout } = await gitRepo.gitExec(['worktree', 'list']);
      expect(stdout).not.toContain('temp-worktree');
    });

    it('should force delete worktree with uncommitted changes', async () => {
      // Create a worktree with uncommitted changes
      const worktreePath = path.join(gitRepo.tmpDir, 'worktree-force-delete');
      await gitRepo.gitExec(['worktree', 'add', worktreePath, '-b', 'temp/force-delete']);

      // Add uncommitted changes
      await fs.writeFile(path.join(worktreePath, 'dirty.txt'), 'uncommitted');

      // Try normal delete (should fail with 409 Conflict)
      const normalDelete = await request(testServer.app)
        .delete(`/api/worktrees/${encodeURIComponent('temp/force-delete')}`)
        .query({ repoPath: gitRepo.repoPath });

      expect(normalDelete.status).toBe(409);

      // Force delete
      const forceDelete = await request(testServer.app)
        .delete(`/api/worktrees/${encodeURIComponent('temp/force-delete')}`)
        .query({ repoPath: gitRepo.repoPath, force: 'true' });

      expect(forceDelete.status).toBe(200);
      expect(forceDelete.body.success).toBe(true);
    });

    it('should prune stale worktrees', async () => {
      // Create a worktree
      const staleBranch = 'temp/stale';
      await gitRepo.gitExec(['checkout', '-b', staleBranch]);
      await gitRepo.gitExec(['checkout', 'main']);

      const staleWorktreePath = path.join(gitRepo.tmpDir, 'stale-worktree');
      await gitRepo.gitExec(['worktree', 'add', staleWorktreePath, staleBranch]);

      // Manually remove the worktree directory to make it stale
      await fs.rm(staleWorktreePath, { recursive: true, force: true });

      // Prune worktrees
      const pruneResponse = await request(testServer.app)
        .post('/api/worktrees/prune')
        .send({ repoPath: gitRepo.repoPath });

      expect(pruneResponse.status).toBe(200);
      expect(pruneResponse.body.success).toBe(true);

      // Verify it was removed
      const { stdout } = await gitRepo.gitExec(['worktree', 'list']);
      expect(stdout).not.toContain('stale-worktree');
    });
  });

  describe('Follow Mode', () => {
    it('should enable follow mode for existing worktree', async () => {
      // Use the existing worktree for feature/test-feature
      const response = await request(testServer.app).post('/api/worktrees/follow').send({
        repoPath: gitRepo.repoPath,
        branch: 'feature/test-feature',
        enable: true,
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.enabled).toBe(true);
      expect(response.body.branch).toBe('feature/test-feature');

      // Verify git config was set (should contain worktree path, not branch name)
      const { stdout } = await gitRepo.gitExec(['config', 'vibetunnel.followWorktree']);
      // The worktree path should end with the branch slug
      expect(stdout).toContain('worktree-feature-test-feature');
    });

    it('should disable follow mode', async () => {
      // First, get the list of worktrees to find the correct path
      const worktreesResponse = await request(testServer.app)
        .get('/api/worktrees')
        .query({ repoPath: gitRepo.repoPath });

      const featureWorktree = worktreesResponse.body.worktrees.find((w: { branch: string }) =>
        w.branch.includes('feature/test-feature')
      );

      // First enable follow mode
      await gitRepo.gitExec([
        'config',
        '--local',
        'vibetunnel.followWorktree',
        featureWorktree.path,
      ]);

      // Disable it
      const response = await request(testServer.app).post('/api/worktrees/follow').send({
        repoPath: gitRepo.repoPath,
        branch: 'feature/test-feature',
        enable: false,
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.enabled).toBe(false);

      // Verify git config was removed
      try {
        await gitRepo.gitExec(['config', 'vibetunnel.followWorktree']);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        // Expected - config should not exist
        expect(error).toBeDefined();
      }
    });
  });

  describe('Session Creation with Git Metadata', () => {
    it('should create session with Git metadata', async () => {
      // Create a session in the test repository
      const createResponse = await request(testServer.app)
        .post('/api/sessions')
        .send({
          command: ['bash'],
          workingDir: gitRepo.repoPath,
          titleMode: 'dynamic',
        });

      expect(createResponse.status).toBe(200);
      expect(createResponse.body.sessionId).toBeDefined();

      const sessionId = createResponse.body.sessionId;
      createdSessionIds.push(sessionId); // Track for cleanup

      // Get session info
      const sessionsResponse = await request(testServer.app).get('/api/sessions');
      const session = sessionsResponse.body.find((s: { id: string }) => s.id === sessionId);

      expect(session).toBeDefined();
      expect(session.gitRepoPath).toBeTruthy();
      expect(session.gitBranch).toBe('main');

      // Clean up immediately
      await request(testServer.app).delete(`/api/sessions/${sessionId}`);
      // Remove from tracking since we cleaned it up
      const index = createdSessionIds.indexOf(sessionId);
      if (index > -1) {
        createdSessionIds.splice(index, 1);
      }
    });

    it('should handle sessions in subdirectories', async () => {
      // Create a subdirectory
      const subDir = path.join(gitRepo.repoPath, 'src', 'components');
      await fs.mkdir(subDir, { recursive: true });

      // Create session in subdirectory
      const createResponse = await request(testServer.app)
        .post('/api/sessions')
        .send({
          command: ['bash'],
          workingDir: subDir,
        });

      expect(createResponse.status).toBe(200);
      const sessionId = createResponse.body.sessionId;
      createdSessionIds.push(sessionId); // Track for cleanup

      // Get session info
      const sessionsResponse = await request(testServer.app).get('/api/sessions');
      const session = sessionsResponse.body.find((s: { id: string }) => s.id === sessionId);

      expect(session).toBeDefined();
      expect(session.gitRepoPath).toBeTruthy();
      expect(session.workingDir).toBe(subDir);

      // Clean up immediately
      await request(testServer.app).delete(`/api/sessions/${sessionId}`);
      // Remove from tracking since we cleaned it up
      const index = createdSessionIds.indexOf(sessionId);
      if (index > -1) {
        createdSessionIds.splice(index, 1);
      }
    });
  });

  describe('Repository Detection', () => {
    it('should correctly identify git repositories', async () => {
      const response = await request(testServer.app)
        .get('/api/git/repo-info')
        .query({ path: gitRepo.repoPath });

      expect(response.status).toBe(200);
      expect(response.body.isGitRepo).toBe(true);

      // Handle macOS /tmp symlink
      const normalizedRepoPath = gitRepo.repoPath.replace(/^\/private/, '');
      const normalizedResponsePath = response.body.repoPath.replace(/^\/private/, '');
      expect(normalizedResponsePath).toBe(normalizedRepoPath);
    });

    it('should detect git repo from subdirectory', async () => {
      const subDir = path.join(gitRepo.repoPath, 'nested', 'deep');
      await fs.mkdir(subDir, { recursive: true });

      const response = await request(testServer.app)
        .get('/api/git/repo-info')
        .query({ path: subDir });

      expect(response.status).toBe(200);
      expect(response.body.isGitRepo).toBe(true);

      // Handle macOS /tmp symlink
      const normalizedRepoPath = gitRepo.repoPath.replace(/^\/private/, '');
      const normalizedResponsePath = response.body.repoPath.replace(/^\/private/, '');
      expect(normalizedResponsePath).toBe(normalizedRepoPath);
    });

    it('should handle non-git directories', async () => {
      const nonGitDir = path.join(gitRepo.tmpDir, 'non-git');
      await fs.mkdir(nonGitDir, { recursive: true });

      const response = await request(testServer.app)
        .get('/api/git/repo-info')
        .query({ path: nonGitDir });

      expect(response.status).toBe(200);
      expect(response.body.isGitRepo).toBe(false);
      expect(response.body.repoPath).toBeUndefined();
    });
  });
});
