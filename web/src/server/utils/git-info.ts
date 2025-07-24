/**
 * Git information detection utilities
 */

import { execFile as execFileCallback } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execFile = promisify(execFileCallback);

/**
 * Git repository information
 */
export interface GitInfo {
  gitRepoPath?: string;
  gitBranch?: string;
  gitAheadCount?: number;
  gitBehindCount?: number;
  gitHasChanges?: boolean;
  gitIsWorktree?: boolean;
  gitMainRepoPath?: string;
}

/**
 * Extract repository path from a worktree's .git file
 */
async function getMainRepositoryPath(workingDir: string): Promise<string | undefined> {
  try {
    const gitFile = path.join(workingDir, '.git');
    const gitContent = await fs.promises.readFile(gitFile, 'utf-8');

    // Parse the .git file format: "gitdir: /path/to/main/.git/worktrees/worktree-name"
    const match = gitContent.match(/^gitdir:\s*(.+)$/m);
    if (!match) return undefined;

    const gitDirPath = match[1].trim();

    // Extract the main repository path from the worktree path
    // Format: /path/to/main/.git/worktrees/worktree-name
    const worktreeMatch = gitDirPath.match(/^(.+)\/\.git\/worktrees\/.+$/);
    if (worktreeMatch) {
      return worktreeMatch[1];
    }

    return undefined;
  } catch {
    return undefined;
  }
}

// Cache for Git info to avoid calling git commands too frequently
const gitInfoCache = new Map<string, { info: GitInfo; timestamp: number }>();
const CACHE_TTL = 5000; // 5 seconds

/**
 * Detect Git repository information for a given directory
 */
export async function detectGitInfo(workingDir: string): Promise<GitInfo> {
  // Check cache first
  const cached = gitInfoCache.get(workingDir);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.info;
  }

  try {
    // Check if the directory is in a Git repository
    const { stdout: repoPath } = await execFile('git', ['rev-parse', '--show-toplevel'], {
      cwd: workingDir,
      timeout: 5000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const gitRepoPath = repoPath.trim();

    // Get the current branch name
    try {
      const { stdout: branch } = await execFile('git', ['branch', '--show-current'], {
        cwd: workingDir,
        timeout: 5000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      const gitBranch = branch.trim();

      // Get additional Git status information
      let gitAheadCount: number | undefined;
      let gitBehindCount: number | undefined;
      let gitHasChanges = false;
      let gitIsWorktree = false;

      try {
        // Check if this is a worktree
        const gitFile = path.join(workingDir, '.git');
        const stats = await fs.promises.stat(gitFile).catch(() => null);

        if (stats && !stats.isDirectory()) {
          // .git is a file, not a directory - this is a worktree
          gitIsWorktree = true;
        }

        // Get ahead/behind counts
        const { stdout: revList } = await execFile(
          'git',
          ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'],
          {
            cwd: workingDir,
            timeout: 5000,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          }
        );
        const [ahead, behind] = revList.trim().split('\t').map(Number);
        gitAheadCount = ahead;
        gitBehindCount = behind;
      } catch {
        // Ignore errors - might not have upstream
      }

      // Check for uncommitted changes
      try {
        await execFile('git', ['diff-index', '--quiet', 'HEAD', '--'], {
          cwd: workingDir,
          timeout: 5000,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        // Command succeeded, no changes
        gitHasChanges = false;
      } catch {
        // Command failed, there are changes
        gitHasChanges = true;
      }

      // Get main repository path if this is a worktree
      const gitMainRepoPath = gitIsWorktree ? await getMainRepositoryPath(workingDir) : gitRepoPath;

      const info: GitInfo = {
        gitRepoPath,
        gitBranch,
        gitAheadCount,
        gitBehindCount,
        gitHasChanges,
        gitIsWorktree,
        gitMainRepoPath,
      };

      // Update cache
      gitInfoCache.set(workingDir, { info, timestamp: Date.now() });

      return info;
    } catch (_branchError) {
      // Could be in detached HEAD state or other situation where branch name isn't available
      const info: GitInfo = {
        gitRepoPath,
        gitBranch: '', // Empty branch for detached HEAD
      };

      // Update cache
      gitInfoCache.set(workingDir, { info, timestamp: Date.now() });

      return info;
    }
  } catch {
    // Not a Git repository
    const info: GitInfo = {};

    // Update cache
    gitInfoCache.set(workingDir, { info, timestamp: Date.now() });

    return info;
  }
}

/**
 * Clear the Git info cache
 */
export function clearGitInfoCache(): void {
  gitInfoCache.clear();
}

/**
 * Clear cache entry for a specific directory
 */
export function clearGitInfoCacheForDir(workingDir: string): void {
  gitInfoCache.delete(workingDir);
}
