/**
 * Git Test Helper
 *
 * Utilities for creating and managing Git repositories in tests
 */

import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface GitTestRepo {
  /**
   * Root path of the test repository
   */
  repoPath: string;

  /**
   * Temporary directory containing the repo
   */
  tmpDir: string;

  /**
   * Execute git commands in this repository
   */
  gitExec: (args: string[], cwd?: string) => Promise<{ stdout: string; stderr: string }>;

  /**
   * Clean up the test repository
   */
  cleanup: () => Promise<void>;
}

export interface CreateTestRepoOptions {
  /**
   * Name of the repository directory
   */
  name?: string;

  /**
   * Whether to create initial commit
   */
  createInitialCommit?: boolean;

  /**
   * Branches to create (with optional commits)
   */
  branches?: Array<{
    name: string;
    files?: Record<string, string>;
    fromBranch?: string;
  }>;

  /**
   * Worktrees to create
   */
  worktrees?: Array<{
    branch: string;
    relativePath?: string;
  }>;

  /**
   * Default branch name
   */
  defaultBranch?: string;
}

/**
 * Create a test Git repository
 */
export async function createTestGitRepo(options: CreateTestRepoOptions = {}): Promise<GitTestRepo> {
  const {
    name = 'test-repo',
    createInitialCommit = true,
    branches = [],
    worktrees = [],
    defaultBranch = 'main',
  } = options;

  // Create temporary directory
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibetunnel-test-'));
  const repoPath = path.join(tmpDir, name);
  await fs.mkdir(repoPath, { recursive: true });

  // Git exec helper
  const gitExec = async (args: string[], cwd: string = repoPath) => {
    try {
      const { stdout, stderr } = await execFileAsync('git', args, { cwd });
      return { stdout: stdout.toString().trim(), stderr: stderr.toString().trim() };
    } catch (error) {
      const err = error as Error & { stderr?: string; stdout?: string };
      throw new Error(
        `Git command failed: ${err.message}\nStderr: ${err.stderr || ''}\nStdout: ${err.stdout || ''}`
      );
    }
  };

  // Initialize repository
  await gitExec(['init', '--initial-branch', defaultBranch]);
  await gitExec(['config', 'user.email', 'test@example.com']);
  await gitExec(['config', 'user.name', 'Test User']);

  // Create initial commit if requested
  if (createInitialCommit) {
    await fs.writeFile(path.join(repoPath, 'README.md'), '# Test Repository\n');
    await gitExec(['add', 'README.md']);
    await gitExec(['commit', '-m', 'Initial commit']);
  }

  // Create branches
  for (const branch of branches) {
    // Switch to base branch if specified
    if (branch.fromBranch) {
      await gitExec(['checkout', branch.fromBranch]);
    }

    // Create and switch to new branch
    await gitExec(['checkout', '-b', branch.name]);

    // Create files if specified
    if (branch.files) {
      for (const [filename, content] of Object.entries(branch.files)) {
        const filePath = path.join(repoPath, filename);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content);
        await gitExec(['add', filename]);
      }
      await gitExec(['commit', '-m', `Add files to ${branch.name}`]);
    }
  }

  // Return to default branch
  await gitExec(['checkout', defaultBranch]);

  // Create worktrees
  for (const worktree of worktrees) {
    const worktreePath = worktree.relativePath
      ? path.join(tmpDir, worktree.relativePath)
      : path.join(tmpDir, `worktree-${worktree.branch.replace(/\//g, '-')}`);
    await gitExec(['worktree', 'add', worktreePath, worktree.branch]);
  }

  // Cleanup function
  const cleanup = async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (_error) {
      // Ignore cleanup errors
    }
  };

  return {
    repoPath,
    tmpDir,
    gitExec,
    cleanup,
  };
}

/**
 * Create a standard test repository with common branches
 */
export async function createStandardTestRepo(): Promise<GitTestRepo> {
  return createTestGitRepo({
    name: 'test-repo',
    createInitialCommit: true,
    branches: [
      {
        name: 'develop',
        files: {
          'src/app.js': 'console.log("develop");',
          'src/utils.js': 'export const VERSION = "1.0.0";',
        },
      },
      {
        name: 'feature/test-feature',
        fromBranch: 'develop',
        files: {
          'src/feature.js': 'console.log("feature");',
        },
      },
      {
        name: 'bugfix/critical-fix',
        files: {
          'src/fix.js': 'console.log("fix");',
        },
      },
    ],
    worktrees: [
      {
        branch: 'feature/test-feature',
      },
    ],
  });
}
