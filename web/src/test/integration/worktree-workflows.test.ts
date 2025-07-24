import { execFile } from 'child_process';
import express from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import request from 'supertest';
import { promisify } from 'util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PtyManager } from '../../server/pty/pty-manager.js';
import type { SessionManager } from '../../server/pty/session-manager.js';
import { createGitRoutes } from '../../server/routes/git.js';
import { createSessionRoutes } from '../../server/routes/sessions.js';
import { createWorktreeRoutes } from '../../server/routes/worktrees.js';
import { ActivityMonitor } from '../../server/services/activity-monitor.js';
import { StreamWatcher } from '../../server/services/stream-watcher.js';
import { TerminalManager } from '../../server/services/terminal-manager.js';
import { SessionTestHelper } from '../helpers/session-test-helper.js';

const execFileAsync = promisify(execFile);

describe('Worktree Workflows Integration Tests', () => {
  let app: express.Application;
  let testRepoPath: string;
  let sessionManager: SessionManager;
  let terminalManager: TerminalManager;
  let activityMonitor: ActivityMonitor;
  let streamWatcher: StreamWatcher;
  let localPtyManager: PtyManager;
  let sessionHelper: SessionTestHelper;

  // Helper to execute git commands
  async function gitExec(args: string[], cwd: string = testRepoPath) {
    try {
      const { stdout, stderr } = await execFileAsync('git', args, { cwd });
      return { stdout: stdout.toString(), stderr: stderr.toString() };
    } catch (error) {
      const err = error as Error & { stderr?: string };
      throw new Error(`Git command failed: ${err.message}\nStderr: ${err.stderr || ''}`);
    }
  }

  // Helper to create a test repository with branches
  async function setupTestRepo() {
    // Create temporary directory
    const tmpDir = await fs.mkdtemp(path.join('/tmp', 'vibetunnel-test-'));
    testRepoPath = path.join(tmpDir, 'test-repo');
    await fs.mkdir(testRepoPath, { recursive: true });

    // Initialize git repo
    await gitExec(['init']);
    await gitExec(['config', 'user.email', 'test@example.com']);
    await gitExec(['config', 'user.name', 'Test User']);

    // Create initial commit
    await fs.writeFile(path.join(testRepoPath, 'README.md'), '# Test Repository\n');
    await gitExec(['add', 'README.md']);
    await gitExec(['commit', '-m', 'Initial commit']);

    // Create feature branch
    await gitExec(['checkout', '-b', 'feature/test-feature']);
    await fs.writeFile(path.join(testRepoPath, 'feature.js'), 'console.log("feature");\n');
    await gitExec(['add', 'feature.js']);
    await gitExec(['commit', '-m', 'Add feature']);

    // Create another branch
    await gitExec(['checkout', '-b', 'bugfix/critical-fix']);
    await fs.writeFile(path.join(testRepoPath, 'fix.js'), 'console.log("fix");\n');
    await gitExec(['add', 'fix.js']);
    await gitExec(['commit', '-m', 'Critical fix']);

    // Return to main branch
    await gitExec(['checkout', 'main']);

    // Create a worktree
    const worktreePath = path.join(tmpDir, 'worktree-feature');
    await gitExec(['worktree', 'add', worktreePath, 'feature/test-feature']);

    return { testRepoPath, worktreePath, tmpDir };
  }

  beforeAll(async () => {
    // Set up test repository
    await setupTestRepo();

    // Initialize services
    terminalManager = new TerminalManager();
    activityMonitor = new ActivityMonitor();
    streamWatcher = new StreamWatcher();

    // Create PtyManager
    localPtyManager = new PtyManager();
    // Get the session manager from ptyManager to ensure we use the same instance
    sessionManager = localPtyManager.getSessionManager();
    sessionHelper = new SessionTestHelper(localPtyManager, sessionManager);

    // Set up Express app
    app = express();
    app.use(express.json());

    const config = {
      ptyManager: localPtyManager,
      terminalManager,
      streamWatcher,
      remoteRegistry: null,
      isHQMode: false,
      activityMonitor,
    };

    // Mount routes
    app.use('/api', createSessionRoutes(config));
    app.use('/api', createWorktreeRoutes());
    app.use('/api', createGitRoutes());
  });

  afterAll(async () => {
    await sessionHelper.killTrackedSessions();

    // Clean up test repository
    if (testRepoPath) {
      const tmpDir = path.dirname(testRepoPath);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    await sessionHelper.killTrackedSessions();
  });

  describe('Complete Worktree Management Flow', () => {
    it('should list worktrees with full metadata', async () => {
      const response = await request(app).get('/api/worktrees').query({ repoPath: testRepoPath });

      expect(response.status).toBe(200);
      expect(response.body.worktrees).toBeDefined();
      // The API should return all worktrees including the main repository
      expect(response.body.worktrees.length).toBe(2); // Main repo + feature worktree
      expect(response.body.baseBranch).toBe('main');

      // Find main repository worktree
      const mainWorktree = response.body.worktrees.find((w: { branch: string; path: string }) => {
        // Handle macOS /tmp symlink
        const normalizedPath = w.path.replace(/^\/private/, '');
        const normalizedRepoPath = testRepoPath.replace(/^\/private/, '');
        return normalizedPath === normalizedRepoPath;
      });
      expect(mainWorktree).toBeDefined();
      expect(mainWorktree.branch).toMatch(/^(refs\/heads\/)?main$/);

      // Find feature worktree (branch might include refs/heads/ prefix)
      const featureWorktree = response.body.worktrees.find((w: { branch: string }) =>
        w.branch.includes('feature/test-feature')
      );
      expect(featureWorktree).toBeDefined();
      expect(featureWorktree.path).toContain('worktree-feature');
      expect(featureWorktree.stats).toBeDefined();
    });

    it('should create session with Git metadata and verify dynamic title', async () => {
      // Create a session in the test repository
      const createResponse = await request(app)
        .post('/api/sessions')
        .send({
          command: ['bash'],
          workingDir: testRepoPath,
          titleMode: 'dynamic',
        });

      expect(createResponse.status).toBe(200);
      const sessionId = createResponse.body.sessionId;
      expect(sessionId).toBeDefined();
      sessionHelper.trackSession(sessionId);

      // Get session info to verify Git metadata
      const sessions = sessionManager.listSessions();
      const session = sessions.find((s) => s.id === sessionId);
      expect(session).toBeDefined();
      // Handle macOS /tmp symlink to /private/tmp
      const normalizedGitRepoPath = session.gitRepoPath?.replace(/^\/private/, '');
      const normalizedTestRepoPath = testRepoPath.replace(/^\/private/, '');
      expect(normalizedGitRepoPath).toBe(normalizedTestRepoPath);
      expect(session.gitBranch).toBe('main');
    });

    it('should switch branches in main worktree', async () => {
      // Switch to bugfix branch (not feature branch which has a worktree)
      const switchResponse = await request(app).post('/api/worktrees/switch').send({
        repoPath: testRepoPath,
        branch: 'bugfix/critical-fix',
      });

      expect(switchResponse.status).toBe(200);
      expect(switchResponse.body.success).toBe(true);
      expect(switchResponse.body.currentBranch).toBe('bugfix/critical-fix');

      // Verify the branch was actually switched
      const { stdout } = await gitExec(['branch', '--show-current']);
      expect(stdout.trim()).toBe('bugfix/critical-fix');

      // Switch back to main
      await gitExec(['checkout', 'main']);
    });

    it('should handle uncommitted changes when switching branches', async () => {
      // Create uncommitted changes
      await fs.writeFile(path.join(testRepoPath, 'uncommitted.txt'), 'test content');

      // Try to switch branch (should fail)
      const switchResponse = await request(app).post('/api/worktrees/switch').send({
        repoPath: testRepoPath,
        branch: 'bugfix/critical-fix',
      });

      expect(switchResponse.status).toBe(400);
      expect(switchResponse.body.error).toContain('uncommitted changes');

      // Clean up
      await fs.unlink(path.join(testRepoPath, 'uncommitted.txt'));
    });

    it('should delete worktree', async () => {
      // Create a new worktree to delete
      const worktreePath = path.join(path.dirname(testRepoPath), 'worktree-to-delete');
      await gitExec(['worktree', 'add', worktreePath, '-b', 'temp/delete-me']);

      // Delete the worktree (encode the branch name for URL)
      const deleteResponse = await request(app)
        .delete(`/api/worktrees/${encodeURIComponent('temp/delete-me')}`)
        .query({ repoPath: testRepoPath });

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.success).toBe(true);

      // Verify worktree was removed
      const listResponse = await request(app)
        .get('/api/worktrees')
        .query({ repoPath: testRepoPath });

      const deletedWorktree = listResponse.body.worktrees.find(
        (w: { branch: string }) => w.branch === 'temp/delete-me'
      );
      expect(deletedWorktree).toBeUndefined();
    });

    it('should force delete worktree with uncommitted changes', async () => {
      // Create a worktree with uncommitted changes
      const worktreePath = path.join(path.dirname(testRepoPath), 'worktree-force-delete');
      await gitExec(['worktree', 'add', worktreePath, '-b', 'temp/force-delete']);

      // Add uncommitted changes
      await fs.writeFile(path.join(worktreePath, 'dirty.txt'), 'uncommitted');

      // Try normal delete (should fail with 409 Conflict)
      const normalDelete = await request(app)
        .delete(`/api/worktrees/${encodeURIComponent('temp/force-delete')}`)
        .query({ repoPath: testRepoPath });

      expect(normalDelete.status).toBe(409);

      // Force delete
      const forceDelete = await request(app)
        .delete(`/api/worktrees/${encodeURIComponent('temp/force-delete')}`)
        .query({ repoPath: testRepoPath, force: 'true' });

      expect(forceDelete.status).toBe(200);
      expect(forceDelete.body.success).toBe(true);
    });

    it('should prune stale worktrees', async () => {
      // Create a worktree
      const staleWorktreePath = path.join(path.dirname(testRepoPath), 'stale-worktree');
      await gitExec(['worktree', 'add', staleWorktreePath, '-b', 'temp/stale']);

      // Manually remove the worktree directory to make it stale
      await fs.rm(staleWorktreePath, { recursive: true, force: true });

      // Verify the stale worktree exists before pruning
      const { stdout: beforePrune } = await gitExec(['worktree', 'list']);
      expect(beforePrune).toContain('temp/stale');

      // Prune worktrees
      const pruneResponse = await request(app)
        .post('/api/worktrees/prune')
        .send({ repoPath: testRepoPath });

      expect(pruneResponse.status).toBe(200);
      expect(pruneResponse.body.success).toBe(true);
      // git worktree prune runs silently when successful, so we won't check output

      // Verify it was removed
      const { stdout: afterPrune } = await gitExec(['worktree', 'list']);
      expect(afterPrune).not.toContain('temp/stale');
    });
  });

  describe('Follow Mode Workflow', () => {
    let followTestRepo: string;

    beforeAll(async () => {
      // Create a separate repo for follow mode tests
      const tmpDir = await fs.mkdtemp(path.join('/tmp', 'vibetunnel-follow-'));
      followTestRepo = path.join(tmpDir, 'follow-repo');
      await fs.mkdir(followTestRepo, { recursive: true });

      // Initialize and set up branches
      await gitExec(['init'], followTestRepo);
      await gitExec(['config', 'user.email', 'test@example.com'], followTestRepo);
      await gitExec(['config', 'user.name', 'Test User'], followTestRepo);

      await fs.writeFile(path.join(followTestRepo, 'README.md'), '# Follow Test\n');
      await gitExec(['add', '.'], followTestRepo);
      await gitExec(['commit', '-m', 'Initial'], followTestRepo);

      await gitExec(['checkout', '-b', 'develop'], followTestRepo);
      await fs.writeFile(path.join(followTestRepo, 'dev.txt'), 'development\n');
      await gitExec(['add', '.'], followTestRepo);
      await gitExec(['commit', '-m', 'Dev work'], followTestRepo);

      await gitExec(['checkout', 'main'], followTestRepo);
    });

    afterAll(async () => {
      await sessionHelper.killTrackedSessions();

      // Clean up follow test repo
      if (followTestRepo) {
        await fs.rm(path.dirname(followTestRepo), { recursive: true, force: true });
      }
    });

    it('should enable follow mode and install hooks', async () => {
      const response = await request(app).post('/api/worktrees/follow').send({
        repoPath: followTestRepo,
        branch: 'develop',
        enable: true,
      });

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(true);
      expect(response.body.branch).toBe('develop');
      expect(response.body.hooksInstalled).toBe(true);

      // Verify hooks were installed
      const postCommitHook = await fs.readFile(
        path.join(followTestRepo, '.git/hooks/post-commit'),
        'utf8'
      );
      expect(postCommitHook).toContain('VibeTunnel Git hook');

      // Verify git config was set
      const { stdout } = await gitExec(['config', 'vibetunnel.followBranch'], followTestRepo);
      expect(stdout.trim()).toBe('develop');
    });

    it('should disable follow mode and uninstall hooks', async () => {
      // First enable follow mode
      await request(app).post('/api/worktrees/follow').send({
        repoPath: followTestRepo,
        branch: 'develop',
        enable: true,
      });

      // Now disable it
      const response = await request(app).post('/api/worktrees/follow').send({
        repoPath: followTestRepo,
        enable: false,
      });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Follow mode disabled');

      // Verify git config was removed
      try {
        await gitExec(['config', 'vibetunnel.followBranch'], followTestRepo);
        // If we get here, the config still exists
        expect(true).toBe(false); // Fail the test
      } catch (error) {
        // Expected - config should not exist when disabled
        expect(error).toBeDefined();
      }
    });

    it('should detect when branches have diverged', async () => {
      // Enable follow mode
      await request(app).post('/api/worktrees/follow').send({
        repoPath: followTestRepo,
        branch: 'develop',
        enable: true,
      });

      // Create diverging commits
      await gitExec(['checkout', 'main'], followTestRepo);
      await fs.writeFile(path.join(followTestRepo, 'main-only.txt'), 'main branch\n');
      await gitExec(['add', '.'], followTestRepo);
      await gitExec(['commit', '-m', 'Main branch commit'], followTestRepo);

      await gitExec(['checkout', 'develop'], followTestRepo);
      await fs.writeFile(path.join(followTestRepo, 'dev-only.txt'), 'dev branch\n');
      await gitExec(['add', '.'], followTestRepo);
      await gitExec(['commit', '-m', 'Dev branch commit'], followTestRepo);

      // Switch back to main
      await gitExec(['checkout', 'main'], followTestRepo);

      // Trigger git event (simulating what a hook would do)
      const eventResponse = await request(app).post('/api/git/event').send({
        repoPath: followTestRepo,
        branch: 'develop',
        event: 'checkout',
      });

      expect(eventResponse.status).toBe(200);
      // Follow mode should be disabled due to divergence
      expect(eventResponse.body.followMode).toBe(false);
    });
  });

  describe('Git Event Processing', () => {
    it('should update session titles on git events', async () => {
      // Create two sessions in the same repo
      const session1Response = await request(app)
        .post('/api/sessions')
        .send({
          command: ['bash'],
          workingDir: testRepoPath,
          name: 'Editor',
          titleMode: 'dynamic',
        });

      const session2Response = await request(app)
        .post('/api/sessions')
        .send({
          command: ['bash'],
          workingDir: path.join(testRepoPath, 'src'),
          name: 'Terminal',
          titleMode: 'dynamic',
        });

      const sessionId1 = session1Response.body.sessionId;
      const sessionId2 = session2Response.body.sessionId;
      sessionHelper.trackSession(sessionId1); // Track these sessions
      sessionHelper.trackSession(sessionId2);

      // Wait a moment for sessions to be fully initialized
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Trigger a git event
      const eventResponse = await request(app).post('/api/git/event').send({
        repoPath: testRepoPath,
        branch: 'feature/test-feature',
        event: 'checkout',
      });

      expect(eventResponse.status).toBe(200);
      expect(eventResponse.body.success).toBe(true);
      expect(eventResponse.body.sessionsUpdated).toBe(2);
      expect(eventResponse.body.notification).toBeDefined();
      expect(eventResponse.body.notification.branch).toBe('feature/test-feature');
      expect(eventResponse.body.notification.event).toBe('checkout');

      // Note: Due to the git routes creating their own SessionManager instance,
      // we can't verify the actual session title updates in this test.
      // The route correctly processes the event and reports updating 2 sessions.
    });

    it('should handle concurrent git events with locking', async () => {
      // Create a session
      const sessionResponse = await request(app)
        .post('/api/sessions')
        .send({
          command: ['bash'],
          workingDir: testRepoPath,
          name: 'Test Session',
        });

      const sessionId = sessionResponse.body.sessionId;
      sessionHelper.trackSession(sessionId); // Track this session

      // Send multiple concurrent events
      const events = Array.from({ length: 5 }, (_, i) => ({
        repoPath: testRepoPath,
        branch: `branch-${i}`,
        event: 'checkout',
      }));

      const responses = await Promise.all(
        events.map((event) => request(app).post('/api/git/event').send(event))
      );

      // All should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      // Clean up
      await localPtyManager.killSession(sessionId);
      sessionManager.cleanupExitedSessions();
    });
  });

  describe('Repository Detection', () => {
    it('should correctly identify git repositories and subpaths', async () => {
      // Test repo root
      const rootResponse = await request(app)
        .get('/api/git/repo-info')
        .query({ path: testRepoPath });

      expect(rootResponse.status).toBe(200);
      expect(rootResponse.body.isGitRepo).toBe(true);
      // Handle macOS /tmp symlink to /private/tmp
      const expectedPath = testRepoPath.replace(/^\/private/, '');
      const actualPath = rootResponse.body.repoPath.replace(/^\/private/, '');
      expect(actualPath).toBe(expectedPath);

      // Test subdirectory
      const subDir = path.join(testRepoPath, 'nested', 'deep');
      await fs.mkdir(subDir, { recursive: true });

      const subResponse = await request(app).get('/api/git/repo-info').query({ path: subDir });

      expect(subResponse.status).toBe(200);
      expect(subResponse.body.isGitRepo).toBe(true);
      // Handle macOS /tmp symlink to /private/tmp
      const subExpectedPath = testRepoPath.replace(/^\/private/, '');
      const subActualPath = subResponse.body.repoPath.replace(/^\/private/, '');
      expect(subActualPath).toBe(subExpectedPath);

      // Test non-git directory
      const nonGitDir = '/tmp';
      const nonGitResponse = await request(app)
        .get('/api/git/repo-info')
        .query({ path: nonGitDir });

      expect(nonGitResponse.status).toBe(200);
      expect(nonGitResponse.body.isGitRepo).toBe(false);
    });
  });
});
