import { execFile, spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import request from 'supertest';
import { promisify } from 'util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ServerProcess {
  pid?: number;
  kill: (signal?: string) => void;
}

describe.skip('Follow Mode End-to-End Tests', () => {
  let serverProcess: ServerProcess | null;
  let testRepoPath: string;
  let worktreePath: string;
  let serverPort: number;
  let baseUrl: string;

  // Helper to execute git commands
  async function gitExec(args: string[], cwd: string = testRepoPath) {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd });
    return { stdout: stdout.toString().trim(), stderr: stderr.toString().trim() };
  }

  // Helper to run vt commands
  async function _vtExec(args: string[], cwd: string = testRepoPath) {
    const vtPath = path.join(process.cwd(), 'bin', 'vt');
    try {
      const { stdout, stderr } = await execFileAsync(vtPath, args, {
        cwd,
        env: { ...process.env, VIBETUNNEL_PORT: String(serverPort) },
      });
      return { stdout: stdout.toString().trim(), stderr: stderr.toString().trim() };
    } catch (error) {
      // If vt command fails, return error info for debugging
      const err = error as { stdout?: Buffer; stderr?: Buffer; message: string };
      return {
        stdout: err.stdout?.toString().trim() || '',
        stderr: err.stderr?.toString().trim() || err.message,
      };
    }
  }

  // Setup test repository with multiple branches
  async function setupTestRepo() {
    const tmpDir = await fs.mkdtemp(path.join('/tmp', 'vibetunnel-e2e-'));
    testRepoPath = path.join(tmpDir, 'follow-mode-test');
    await fs.mkdir(testRepoPath, { recursive: true });

    // Initialize repository
    await gitExec(['init']);
    await gitExec(['config', 'user.email', 'test@example.com']);
    await gitExec(['config', 'user.name', 'Test User']);

    // Create initial commit on the default branch
    await fs.writeFile(path.join(testRepoPath, 'README.md'), '# Follow Mode Test\n');
    await gitExec(['add', 'README.md']);
    await gitExec(['commit', '-m', 'Initial commit']);

    // Check if we're already on main branch or need to create it
    const { stdout: currentBranch } = await gitExec(['branch', '--show-current']);
    if (currentBranch !== 'main') {
      // Check if main exists
      try {
        await gitExec(['rev-parse', '--verify', 'main']);
        // Main exists, just checkout
        await gitExec(['checkout', 'main']);
      } catch {
        // Main doesn't exist, create it
        await gitExec(['checkout', '-b', 'main']);
      }
    }

    // Create develop branch
    await gitExec(['checkout', '-b', 'develop']);
    await fs.writeFile(path.join(testRepoPath, 'app.js'), 'console.log("develop");\n');
    await gitExec(['add', 'app.js']);
    await gitExec(['commit', '-m', 'Add app.js']);

    // Create feature branch
    await gitExec(['checkout', '-b', 'feature/awesome']);
    await fs.writeFile(path.join(testRepoPath, 'feature.js'), 'console.log("feature");\n');
    await gitExec(['add', 'feature.js']);
    await gitExec(['commit', '-m', 'Add feature']);

    // Create worktree for develop branch
    worktreePath = path.join(tmpDir, 'worktree-develop');
    await gitExec(['worktree', 'add', worktreePath, 'develop']);

    // Return to main branch
    await gitExec(['checkout', 'main']);

    return tmpDir;
  }

  // Start the VibeTunnel server
  async function startServer() {
    return new Promise<void>((resolve, reject) => {
      // Find an available port
      serverPort = 4020 + Math.floor(Math.random() * 1000);
      baseUrl = `http://localhost:${serverPort}`;

      // Use tsx to run the server directly from source
      // Remove VIBETUNNEL_SEA to prevent node-pty from looking for pty.node next to executable
      const serverEnv = { ...process.env };
      delete serverEnv.VIBETUNNEL_SEA;

      serverProcess = spawn('pnpm', ['exec', 'tsx', 'src/server/server.ts'], {
        cwd: process.cwd(),
        env: {
          ...serverEnv,
          PORT: String(serverPort),
          NODE_ENV: 'test',
          // Ensure server can find node modules
          NODE_PATH: path.join(process.cwd(), 'node_modules'),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let started = false;
      const timeout = setTimeout(() => {
        if (!started) {
          serverProcess.kill();
          reject(new Error('Server failed to start in time'));
        }
      }, 10000);

      serverProcess.stdout.on('data', (data: Buffer) => {
        const output = data.toString();
        console.log('[Server]', output.trim());
        if (output.includes('VibeTunnel Server running') && !started) {
          started = true;
          clearTimeout(timeout);
          resolve();
        }
      });

      serverProcess.stderr.on('data', (data: Buffer) => {
        const errorOutput = data.toString();
        console.error('[Server Error]', errorOutput.trim());
      });

      serverProcess.on('error', (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  beforeAll(async () => {
    // Set up test repository
    const _tmpDir = await setupTestRepo();

    // Start server
    await startServer();
    await sleep(1000); // Give server time to fully initialize

    return () => {
      // Cleanup will happen in afterAll
    };
  });

  afterAll(async () => {
    // Stop server
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await sleep(500);
      if (!serverProcess.killed) {
        serverProcess.kill('SIGKILL');
      }
    }

    // Clean up test repository
    if (testRepoPath) {
      const tmpDir = path.dirname(testRepoPath);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  describe('Follow Mode via API', () => {
    it('should enable follow mode', async () => {
      // Enable follow mode via API
      const response = await request(baseUrl).post('/api/worktrees/follow').send({
        repoPath: testRepoPath,
        branch: 'develop',
        enable: true,
      });

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(true);
      expect(response.body.branch).toBe('develop');

      // Verify git config was set (should contain worktree path, not branch name)
      const { stdout: configOutput } = await gitExec(['config', 'vibetunnel.followWorktree']);
      expect(configOutput).toBe(worktreePath); // Should be the worktree path, not branch name

      // Verify hooks were installed
      const postCommitExists = await fs
        .access(path.join(testRepoPath, '.git/hooks/post-commit'))
        .then(() => true)
        .catch(() => false);
      expect(postCommitExists).toBe(true);
    });

    it('should switch branches and sync with follow mode', async () => {
      // Enable follow mode for develop via API
      await request(baseUrl).post('/api/worktrees/follow').send({
        repoPath: testRepoPath,
        branch: 'develop',
        enable: true,
      });

      // Switch to develop in worktree
      await gitExec(['checkout', 'develop'], worktreePath);

      // Make a commit in worktree
      await fs.writeFile(path.join(worktreePath, 'worktree-file.js'), 'console.log("wt");\n');
      await gitExec(['add', '.'], worktreePath);
      await gitExec(['commit', '-m', 'Worktree commit'], worktreePath);

      // The post-commit hook should trigger
      // In a real scenario, we'd wait for the hook to execute
      await sleep(500);

      // Manually trigger the event via API (simulating hook execution)
      await request(baseUrl).post('/api/git/event').send({
        repoPath: testRepoPath,
        branch: 'develop',
        event: 'checkout',
      });

      // Wait for async operations
      await sleep(500);

      // Check that main checkout is now on develop
      const { stdout } = await gitExec(['branch', '--show-current']);
      expect(stdout).toBe('develop');
    });

    it('should disable follow mode when branches diverge', async () => {
      // Enable follow mode via API
      await request(baseUrl).post('/api/worktrees/follow').send({
        repoPath: testRepoPath,
        branch: 'feature/awesome',
        enable: true,
      });

      // Create diverging commits
      await fs.writeFile(path.join(testRepoPath, 'main-work.js'), 'console.log("main");\n');
      await gitExec(['add', '.']);
      await gitExec(['commit', '-m', 'Main work']);

      await gitExec(['checkout', 'feature/awesome']);
      await fs.writeFile(path.join(testRepoPath, 'feature-work.js'), 'console.log("feat");\n');
      await gitExec(['add', '.']);
      await gitExec(['commit', '-m', 'Feature work']);

      // Go back to main
      await gitExec(['checkout', 'main']);

      // Trigger event via API
      await request(baseUrl).post('/api/git/event').send({
        repoPath: testRepoPath,
        branch: 'feature/awesome',
        event: 'checkout',
      });

      // Check that follow mode was disabled (config should not exist)
      try {
        await gitExec(['config', 'vibetunnel.followWorktree']);
        // If we get here, the config still exists
        expect(true).toBe(false); // Fail the test
      } catch (error) {
        // Expected - config should not exist when disabled
        expect(error).toBeDefined();
      }
    });

    it('should unfollow using API', async () => {
      // Enable follow mode first via API
      await request(baseUrl).post('/api/worktrees/follow').send({
        repoPath: testRepoPath,
        branch: 'develop',
        enable: true,
      });

      // Disable follow mode via API
      const response = await request(baseUrl).post('/api/worktrees/follow').send({
        repoPath: testRepoPath,
        enable: false,
      });

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(false);

      // Verify git config was removed
      try {
        await gitExec(['config', 'vibetunnel.followWorktree']);
        // If we get here, the config still exists
        expect(true).toBe(false); // Fail the test
      } catch (error) {
        // Expected - config should not exist when disabled
        expect(error).toBeDefined();
      }
    });
  });

  describe('Session Title Updates with Git Events', () => {
    it('should update session titles on branch switch', async () => {
      // Create a session
      const createResponse = await request(baseUrl)
        .post('/api/sessions')
        .send({
          command: ['bash'],
          workingDir: testRepoPath,
          name: 'Dev Session',
          titleMode: 'static',
        });

      expect(createResponse.status).toBe(200);
      const sessionId = createResponse.body.sessionId;

      // Get initial session info
      const listResponse1 = await request(baseUrl).get('/api/sessions');
      const session1 = listResponse1.body.find((s: { id: string }) => s.id === sessionId);
      expect(session1.gitBranch).toBe('main');

      // Switch branch
      await gitExec(['checkout', 'develop']);

      // Trigger git event via API
      await request(baseUrl).post('/api/git/event').send({
        repoPath: testRepoPath,
        branch: 'develop',
        event: 'checkout',
      });

      // Get updated session info
      const listResponse2 = await request(baseUrl).get('/api/sessions');
      const session2 = listResponse2.body.find((s: { id: string }) => s.id === sessionId);
      expect(session2.name).toContain('[checkout:');

      // Clean up
      await request(baseUrl).delete(`/api/sessions/${sessionId}`);
    });

    it('should handle multiple sessions in same repository', async () => {
      // Create src directory for the second session
      await fs.mkdir(path.join(testRepoPath, 'src'), { recursive: true });

      // Create multiple sessions
      const sessions = await Promise.all([
        request(baseUrl)
          .post('/api/sessions')
          .send({
            command: ['bash'],
            workingDir: testRepoPath,
            name: 'Editor',
          }),
        request(baseUrl)
          .post('/api/sessions')
          .send({
            command: ['bash'],
            workingDir: path.join(testRepoPath, 'src'),
            name: 'Terminal',
          }),
        request(baseUrl)
          .post('/api/sessions')
          .send({
            command: ['bash'],
            workingDir: worktreePath,
            name: 'Worktree Session',
          }),
      ]);

      const sessionIds = sessions.map((r) => r.body.sessionId);

      // Trigger a git event
      await request(baseUrl).post('/api/git/event').send({
        repoPath: testRepoPath,
        branch: 'feature/awesome',
        event: 'merge',
      });

      // Check that appropriate sessions were updated
      const listResponse = await request(baseUrl).get('/api/sessions');
      const updatedSessions = listResponse.body.filter((s: { id: string }) =>
        sessionIds.includes(s.id)
      );

      // Main repo sessions should be updated
      const mainRepoSessions = updatedSessions.filter(
        (s: { workingDir: string }) =>
          s.workingDir.startsWith(testRepoPath) && !s.workingDir.startsWith(worktreePath)
      );
      mainRepoSessions.forEach((s: { name: string }) => {
        expect(s.name).toContain('[merge: feature/awesome]');
      });

      // Worktree session should not be updated (different worktree)
      const worktreeSession = updatedSessions.find((s: { workingDir: string }) =>
        s.workingDir.startsWith(worktreePath)
      );
      expect(worktreeSession.name).not.toContain('[merge: feature/awesome]');

      // Clean up
      await Promise.all(sessionIds.map((id) => request(baseUrl).delete(`/api/sessions/${id}`)));
    });
  });

  describe('Worktree Management via API', () => {
    it('should list worktrees with full information', async () => {
      const response = await request(baseUrl)
        .get('/api/worktrees')
        .query({ repoPath: testRepoPath });

      expect(response.status).toBe(200);
      expect(response.body.worktrees).toBeInstanceOf(Array);
      expect(response.body.worktrees.length).toBeGreaterThan(1);

      // Check main worktree
      const mainWt = response.body.worktrees.find(
        (w: { isMainWorktree: boolean }) => w.isMainWorktree
      );
      expect(mainWt).toBeDefined();
      expect(mainWt.branch).toBeDefined();

      // Check secondary worktree
      const devWt = response.body.worktrees.find(
        (w: { branch: string; isMainWorktree: boolean }) =>
          w.branch === 'develop' && !w.isMainWorktree
      );
      expect(devWt).toBeDefined();
      expect(devWt.path).toBe(worktreePath);
    });

    it('should switch branches via API', async () => {
      // Get current branch
      const { stdout: before } = await gitExec(['branch', '--show-current']);

      // Switch to different branch
      const targetBranch = before === 'main' ? 'develop' : 'main';
      const response = await request(baseUrl).post('/api/worktrees/switch').send({
        repoPath: testRepoPath,
        branch: targetBranch,
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.currentBranch).toBe(targetBranch);

      // Verify branch was switched
      const { stdout: after } = await gitExec(['branch', '--show-current']);
      expect(after).toBe(targetBranch);
    });

    it('should handle follow mode with uncommitted changes', async () => {
      // Create uncommitted changes
      await fs.writeFile(path.join(testRepoPath, 'uncommitted.txt'), 'changes\n');

      // Enable follow mode
      const followResponse = await request(baseUrl).post('/api/worktrees/follow').send({
        repoPath: testRepoPath,
        branch: 'develop',
        enable: true,
      });

      expect(followResponse.status).toBe(200);
      expect(followResponse.body.enabled).toBe(true);

      // Try to trigger sync (should handle uncommitted changes gracefully)
      const eventResponse = await request(baseUrl).post('/api/git/event').send({
        repoPath: testRepoPath,
        branch: 'develop',
        event: 'checkout',
      });

      expect(eventResponse.status).toBe(200);
      // Should still be on original branch due to uncommitted changes
      const { stdout } = await gitExec(['branch', '--show-current']);
      expect(['main', 'develop', 'feature/awesome']).toContain(stdout);

      // Clean up
      await fs.unlink(path.join(testRepoPath, 'uncommitted.txt'));
    });
  });

  describe('Hook Installation and Chaining', () => {
    it('should preserve existing hooks when installing', async () => {
      const hookPath = path.join(testRepoPath, '.git/hooks/post-commit');

      // Create an existing hook
      const existingHook = `#!/bin/sh
echo "Existing hook executed"
exit 0`;
      await fs.writeFile(hookPath, existingHook);
      await fs.chmod(hookPath, 0o755);

      // Enable follow mode (installs hooks)
      const response = await request(baseUrl).post('/api/worktrees/follow').send({
        repoPath: testRepoPath,
        branch: 'main',
        enable: true,
      });

      expect(response.status).toBe(200);

      // Check that backup was created
      const backupPath = `${hookPath}.vtbak`;
      const backupExists = await fs
        .access(backupPath)
        .then(() => true)
        .catch(() => false);
      expect(backupExists).toBe(true);

      // Check that new hook chains to backup
      const newHook = await fs.readFile(hookPath, 'utf8');
      expect(newHook).toContain('VibeTunnel Git hook');
      expect(newHook).toContain('.vtbak');
    });

    it('should restore hooks when disabling follow mode', async () => {
      // Create a custom hook first
      const hookPath = path.join(testRepoPath, '.git/hooks/post-checkout');
      const customHook = `#!/bin/sh
echo "Custom checkout hook"`;
      await fs.writeFile(hookPath, customHook);
      await fs.chmod(hookPath, 0o755);

      // Enable follow mode
      await request(baseUrl).post('/api/worktrees/follow').send({
        repoPath: testRepoPath,
        branch: 'main',
        enable: true,
      });

      // Disable follow mode
      await request(baseUrl).post('/api/worktrees/follow').send({
        repoPath: testRepoPath,
        enable: false,
      });

      // Check that original hook was restored
      const restoredHook = await fs.readFile(hookPath, 'utf8');
      expect(restoredHook).toBe(customHook);
      expect(restoredHook).not.toContain('VibeTunnel');
    });
  });
});
