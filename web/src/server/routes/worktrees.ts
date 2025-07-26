import { Router } from 'express';
import * as path from 'path';
import { promisify } from 'util';
import { createGitError, type GitError, isGitConfigNotFoundError } from '../utils/git-error.js';
import { areHooksInstalled, installGitHooks, uninstallGitHooks } from '../utils/git-hooks.js';
import { createLogger } from '../utils/logger.js';
import { createControlEvent } from '../websocket/control-protocol.js';
import { controlUnixHandler } from '../websocket/control-unix-handler.js';

const logger = createLogger('worktree-routes');
const execFile = promisify(require('child_process').execFile);

interface Worktree {
  path: string;
  branch: string;
  HEAD: string;
  detached: boolean;
  prunable?: boolean;
  locked?: boolean;
  lockedReason?: string;
  // Extended stats
  commitsAhead?: number;
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
  hasUncommittedChanges?: boolean;
}

interface WorktreeStats {
  commitsAhead: number;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

/**
 * Execute a git command with proper error handling and security
 * @param args Git command arguments
 * @param options Execution options
 * @returns Command output
 */
async function execGit(
  args: string[],
  options: { cwd?: string; timeout?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFile('git', args, {
      cwd: options.cwd || process.cwd(),
      timeout: options.timeout || 10000, // 10s for potentially slow operations
      maxBuffer: 10 * 1024 * 1024, // 10MB for large diffs
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, // Disable git prompts
    });
    return { stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (error) {
    // Re-throw with more context
    throw createGitError(error, 'Git command failed');
  }
}

/**
 * Detect the repository's default branch
 * @param repoPath Repository path
 * @returns Default branch name
 */
async function detectDefaultBranch(repoPath: string): Promise<string> {
  try {
    // Try to get the default branch from origin
    const { stdout } = await execGit(['symbolic-ref', 'refs/remotes/origin/HEAD'], {
      cwd: repoPath,
    });
    // Output format: refs/remotes/origin/main
    const match = stdout.trim().match(/refs\/remotes\/origin\/(.+)$/);
    if (match) {
      return match[1];
    }
  } catch (_error) {
    logger.debug('Could not detect default branch from origin');
  }

  // Fallback: check if main exists
  try {
    await execGit(['rev-parse', '--verify', 'main'], { cwd: repoPath });
    return 'main';
  } catch {
    // Fallback to master
    return 'master';
  }
}

/**
 * Parse git worktree list --porcelain output
 * @param output Git command output
 * @returns Parsed worktrees
 */
function parseWorktreePorcelain(output: string): Worktree[] {
  const worktrees: Worktree[] = [];
  const lines = output.trim().split('\n');

  let current: Partial<Worktree> | null = null;

  for (const line of lines) {
    if (line === '') {
      if (current?.path && current.HEAD) {
        worktrees.push({
          path: current.path,
          branch: current.branch || 'HEAD',
          HEAD: current.HEAD,
          detached: current.detached || false,
          prunable: current.prunable,
          locked: current.locked,
          lockedReason: current.lockedReason,
        });
      }
      current = null;
      continue;
    }

    const [key, ...valueParts] = line.split(' ');
    const value = valueParts.join(' ');

    if (key === 'worktree') {
      current = { path: value };
    } else if (current) {
      switch (key) {
        case 'HEAD':
          current.HEAD = value;
          break;
        case 'branch':
          current.branch = value;
          break;
        case 'detached':
          current.detached = true;
          break;
        case 'prunable':
          current.prunable = true;
          break;
        case 'locked':
          current.locked = true;
          if (value) {
            current.lockedReason = value;
          }
          break;
      }
    }
  }

  // Handle last worktree if no trailing newline
  if (current?.path && current.HEAD) {
    worktrees.push({
      path: current.path,
      branch: current.branch || 'HEAD',
      HEAD: current.HEAD,
      detached: current.detached || false,
      prunable: current.prunable,
      locked: current.locked,
      lockedReason: current.lockedReason,
    });
  }

  return worktrees;
}

/**
 * Get commit and diff stats for a branch
 * @param repoPath Repository path
 * @param branch Branch name
 * @param baseBranch Base branch to compare against
 * @returns Stats
 */
async function getBranchStats(
  repoPath: string,
  branch: string,
  baseBranch: string
): Promise<WorktreeStats> {
  const stats: WorktreeStats = {
    commitsAhead: 0,
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
  };

  try {
    // Get commit count
    const { stdout: commitCount } = await execGit(
      ['rev-list', '--count', `${baseBranch}...${branch}`],
      { cwd: repoPath }
    );
    stats.commitsAhead = Number.parseInt(commitCount.trim()) || 0;
  } catch (error) {
    logger.debug(`Could not get commit count for ${branch}: ${error}`);
  }

  try {
    // Get diff stats
    const { stdout: diffStat } = await execGit(
      ['diff', '--shortstat', `${baseBranch}...${branch}`],
      { cwd: repoPath }
    );

    // Parse output like: "3 files changed, 10 insertions(+), 5 deletions(-)"
    const match = diffStat.match(
      /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/
    );
    if (match) {
      stats.filesChanged = Number.parseInt(match[1]) || 0;
      stats.insertions = Number.parseInt(match[2]) || 0;
      stats.deletions = Number.parseInt(match[3]) || 0;
    }
  } catch (error) {
    logger.debug(`Could not get diff stats for ${branch}: ${error}`);
  }

  return stats;
}

/**
 * Check if a worktree has uncommitted changes
 * @param worktreePath Worktree path
 * @returns True if there are uncommitted changes
 */
async function hasUncommittedChanges(worktreePath: string): Promise<boolean> {
  try {
    const { stdout } = await execGit(['status', '--porcelain'], { cwd: worktreePath });
    return stdout.trim().length > 0;
  } catch (error) {
    logger.debug(`Could not check uncommitted changes for ${worktreePath}: ${error}`);
    return false;
  }
}

/**
 * Slugify branch name for directory naming
 * @param branch Branch name
 * @returns Slugified name
 */
function _slugifyBranch(branch: string): string {
  return branch
    .replace(/\//g, '-')
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .toLowerCase();
}

/**
 * Create worktree management routes
 */
export function createWorktreeRoutes(): Router {
  const router = Router();

  /**
   * GET /api/worktrees
   * List all worktrees with extended information
   */
  router.get('/worktrees', async (req, res) => {
    try {
      const { repoPath } = req.query;

      if (!repoPath || typeof repoPath !== 'string') {
        return res.status(400).json({
          error: 'Missing or invalid repoPath parameter',
        });
      }

      const absoluteRepoPath = path.resolve(repoPath);
      logger.debug(`Listing worktrees for repo: ${absoluteRepoPath}`);

      // Detect default branch
      const baseBranch = await detectDefaultBranch(absoluteRepoPath);
      logger.debug(`Using base branch: ${baseBranch}`);

      // Get follow branch if configured
      let followBranch: string | undefined;
      try {
        const { stdout } = await execGit(['config', 'vibetunnel.followBranch'], {
          cwd: absoluteRepoPath,
        });
        followBranch = stdout.trim() || undefined;
      } catch {
        // No follow branch configured
      }

      // Get worktree list
      const { stdout } = await execGit(['worktree', 'list', '--porcelain'], {
        cwd: absoluteRepoPath,
      });

      const allWorktrees = parseWorktreePorcelain(stdout);

      // Enrich all worktrees with additional stats (including main repository)
      const enrichedWorktrees = await Promise.all(
        allWorktrees.map(async (worktree) => {
          // Skip stats for detached HEAD
          if (worktree.detached || !worktree.branch) {
            return worktree;
          }

          // Get branch stats
          const stats = await getBranchStats(worktree.path, worktree.branch, baseBranch);

          // Check for uncommitted changes
          const hasChanges = await hasUncommittedChanges(worktree.path);

          return {
            ...worktree,
            ...stats,
            stats, // Also include stats as a nested object for compatibility
            hasUncommittedChanges: hasChanges,
          };
        })
      );

      return res.json({
        worktrees: enrichedWorktrees,
        baseBranch,
        followBranch,
      });
    } catch (error) {
      logger.error('Error listing worktrees:', error);
      const gitError = error as GitError;

      // Check if it's a "not a git repository" error or git not found
      if (gitError.code === 'ENOENT' || gitError.stderr?.includes('not a git repository')) {
        // Return empty worktrees list for non-git directories or when git is not available
        return res.json({
          worktrees: [],
          baseBranch: 'main',
          followBranch: undefined,
        });
      }

      return res.status(500).json({
        error: 'Failed to list worktrees',
        details: gitError.stderr || gitError.message,
      });
    }
  });

  /**
   * DELETE /api/worktrees/:branch
   * Remove a worktree
   */
  router.delete('/worktrees/:branch', async (req, res) => {
    try {
      const { branch } = req.params;
      const { repoPath, force } = req.query;

      if (!repoPath || typeof repoPath !== 'string') {
        return res.status(400).json({
          error: 'Missing or invalid repoPath parameter',
        });
      }

      const absoluteRepoPath = path.resolve(repoPath);
      const forceDelete = force === 'true';

      logger.debug(`Removing worktree for branch: ${branch}, force: ${forceDelete}`);

      // First, find the worktree path for this branch
      const { stdout: listOutput } = await execGit(['worktree', 'list', '--porcelain'], {
        cwd: absoluteRepoPath,
      });

      const worktrees = parseWorktreePorcelain(listOutput);
      const worktree = worktrees.find((w) => {
        // Match against both the full ref path and the short branch name
        const shortBranch = w.branch?.replace(/^refs\/heads\//, '');
        return w.branch === `refs/heads/${branch}` || shortBranch === branch || w.branch === branch;
      });

      if (!worktree) {
        return res.status(404).json({
          error: `Worktree for branch '${branch}' not found`,
        });
      }

      // Check for uncommitted changes if not forcing
      if (!forceDelete) {
        const hasChanges = await hasUncommittedChanges(worktree.path);
        if (hasChanges) {
          return res.status(409).json({
            error: 'Worktree has uncommitted changes',
            worktreePath: worktree.path,
          });
        }
      }

      // Remove the worktree
      const removeArgs = ['worktree', 'remove'];
      if (forceDelete) {
        removeArgs.push('--force');
      }
      removeArgs.push(worktree.path);

      await execGit(removeArgs, { cwd: absoluteRepoPath });

      logger.info(`Successfully removed worktree: ${worktree.path}`);
      return res.json({
        success: true,
        message: 'Worktree removed successfully',
        removedPath: worktree.path,
      });
    } catch (error) {
      logger.error('Error removing worktree:', error);
      const gitError = error as GitError;
      return res.status(500).json({
        error: 'Failed to remove worktree',
        details: gitError.stderr || gitError.message,
      });
    }
  });

  /**
   * POST /api/worktrees/prune
   * Prune worktree information
   */
  router.post('/worktrees/prune', async (req, res) => {
    try {
      const { repoPath } = req.body;

      if (!repoPath || typeof repoPath !== 'string') {
        return res.status(400).json({
          error: 'Missing or invalid repoPath in request body',
        });
      }

      const absoluteRepoPath = path.resolve(repoPath);
      logger.debug(`Pruning worktrees for repo: ${absoluteRepoPath}`);

      const { stdout, stderr } = await execGit(['worktree', 'prune'], { cwd: absoluteRepoPath });

      logger.info('Successfully pruned worktree information');
      return res.json({
        success: true,
        message: 'Worktree information pruned successfully',
        output: stdout || stderr || 'No output',
        pruned: stdout || stderr || '',
      });
    } catch (error) {
      logger.error('Error pruning worktrees:', error);
      const gitError = error as GitError;
      return res.status(500).json({
        error: 'Failed to prune worktrees',
        details: gitError.stderr || gitError.message,
      });
    }
  });

  /**
   * POST /api/worktrees/switch
   * Switch main repository to a branch and enable follow mode
   */
  router.post('/worktrees/switch', async (req, res) => {
    try {
      const { repoPath, branch } = req.body;

      if (!repoPath || typeof repoPath !== 'string') {
        return res.status(400).json({
          error: 'Missing or invalid repoPath in request body',
        });
      }

      if (!branch || typeof branch !== 'string') {
        return res.status(400).json({
          error: 'Missing or invalid branch in request body',
        });
      }

      const absoluteRepoPath = path.resolve(repoPath);
      logger.debug(`Switching to branch: ${branch} in repo: ${absoluteRepoPath}`);

      // Check for uncommitted changes before switching
      const hasChanges = await hasUncommittedChanges(absoluteRepoPath);
      if (hasChanges) {
        return res.status(400).json({
          error: 'Cannot switch branches with uncommitted changes',
          details: 'Please commit or stash your changes before switching branches',
        });
      }

      // Switch to the branch
      await execGit(['checkout', branch], { cwd: absoluteRepoPath });

      // Enable follow mode for the switched branch
      await execGit(['config', '--local', 'vibetunnel.followBranch', branch], {
        cwd: absoluteRepoPath,
      });

      logger.info(`Successfully switched to branch: ${branch} with follow mode enabled`);
      return res.json({
        success: true,
        message: 'Switched to branch and enabled follow mode',
        branch,
        currentBranch: branch,
      });
    } catch (error) {
      logger.error('Error switching branch:', error);
      const gitError = error as GitError;
      return res.status(500).json({
        error: 'Failed to switch branch',
        details: gitError.stderr || gitError.message,
      });
    }
  });

  /**
   * POST /api/worktrees
   * Create a new worktree
   */
  router.post('/worktrees', async (req, res) => {
    try {
      const { repoPath, branch, path: worktreePath, baseBranch } = req.body;

      if (!repoPath || typeof repoPath !== 'string') {
        return res.status(400).json({
          error: 'Missing or invalid repoPath in request body',
        });
      }

      if (!branch || typeof branch !== 'string') {
        return res.status(400).json({
          error: 'Missing or invalid branch in request body',
        });
      }

      if (!worktreePath || typeof worktreePath !== 'string') {
        return res.status(400).json({
          error: 'Missing or invalid path in request body',
        });
      }

      const absoluteRepoPath = path.resolve(repoPath);
      const absoluteWorktreePath = path.resolve(worktreePath);

      logger.debug(`Creating worktree for branch: ${branch} at path: ${absoluteWorktreePath}`);

      // Create the worktree
      const createArgs = ['worktree', 'add'];

      // If baseBranch is provided, create new branch from it
      if (baseBranch) {
        createArgs.push('-b', branch, absoluteWorktreePath, baseBranch);
      } else {
        // Otherwise just checkout existing branch
        createArgs.push(absoluteWorktreePath, branch);
      }

      await execGit(createArgs, { cwd: absoluteRepoPath });

      logger.info(`Successfully created worktree at: ${absoluteWorktreePath}`);
      return res.json({
        message: 'Worktree created successfully',
        worktreePath: absoluteWorktreePath,
        branch,
      });
    } catch (error) {
      logger.error('Error creating worktree:', error);
      const gitError = error as GitError;
      return res.status(500).json({
        error: 'Failed to create worktree',
        details: gitError.stderr || gitError.message,
      });
    }
  });

  /**
   * POST /api/worktrees/follow
   * Enable or disable follow mode for a branch
   */
  router.post('/worktrees/follow', async (req, res) => {
    try {
      const { repoPath, branch, enable } = req.body;

      if (!repoPath || typeof repoPath !== 'string') {
        return res.status(400).json({
          error: 'Missing or invalid repoPath in request body',
        });
      }

      if (typeof enable !== 'boolean') {
        return res.status(400).json({
          error: 'Missing or invalid enable flag in request body',
        });
      }

      // Branch is only required when enabling follow mode
      if (enable && (!branch || typeof branch !== 'string')) {
        return res.status(400).json({
          error: 'Missing or invalid branch in request body',
        });
      }

      const absoluteRepoPath = path.resolve(repoPath);
      logger.debug(
        `${enable ? 'Enabling' : 'Disabling'} follow mode${branch ? ` for branch: ${branch}` : ''}`
      );

      if (enable) {
        // Check if Git hooks are already installed
        const hooksAlreadyInstalled = await areHooksInstalled(absoluteRepoPath);
        logger.debug(`Git hooks installed: ${hooksAlreadyInstalled}`);

        let hooksInstallResult = null;
        if (!hooksAlreadyInstalled) {
          // Install Git hooks
          logger.info('Installing Git hooks for follow mode');
          const installResult = await installGitHooks(absoluteRepoPath);
          hooksInstallResult = installResult;

          if (!installResult.success) {
            logger.error('Failed to install Git hooks:', installResult.errors);
            return res.status(500).json({
              error: 'Failed to install Git hooks',
              details: installResult.errors,
            });
          }

          logger.info('Git hooks installed successfully');
        }

        // Set the follow mode config to the branch name
        await execGit(['config', '--local', 'vibetunnel.followBranch', branch], {
          cwd: absoluteRepoPath,
        });

        logger.info(`Follow mode enabled for branch: ${branch}`);

        // Send notification to Mac app
        if (controlUnixHandler.isMacAppConnected()) {
          const notification = createControlEvent('system', 'notification', {
            level: 'info',
            title: 'Follow Mode Enabled',
            message: `Now following branch '${branch}' in ${path.basename(absoluteRepoPath)}`,
          });
          controlUnixHandler.sendToMac(notification);
        }

        return res.json({
          success: true,
          enabled: true,
          message: 'Follow mode enabled',
          branch,
          hooksInstalled: true,
          hooksInstallResult: hooksInstallResult,
        });
      } else {
        // Unset the follow branch config
        await execGit(['config', '--local', '--unset', 'vibetunnel.followBranch'], {
          cwd: absoluteRepoPath,
        });

        // Uninstall Git hooks when disabling follow mode
        logger.info('Uninstalling Git hooks');
        const uninstallResult = await uninstallGitHooks(absoluteRepoPath);

        if (!uninstallResult.success) {
          logger.warn('Failed to uninstall some Git hooks:', uninstallResult.errors);
          // Continue anyway - follow mode is still disabled
        } else {
          logger.info('Git hooks uninstalled successfully');
        }

        logger.info('Follow mode disabled');

        // Send notification to Mac app
        if (controlUnixHandler.isMacAppConnected()) {
          const notification = createControlEvent('system', 'notification', {
            level: 'info',
            title: 'Follow Mode Disabled',
            message: `Follow mode has been disabled for ${path.basename(absoluteRepoPath)}`,
          });
          controlUnixHandler.sendToMac(notification);
        }

        return res.json({
          success: true,
          enabled: false,
          message: 'Follow mode disabled',
          branch,
        });
      }
    } catch (error) {
      // Ignore error if config key doesn't exist when unsetting
      if (isGitConfigNotFoundError(error) && !req.body.enable) {
        logger.debug('Follow mode was already disabled');
        return res.json({
          success: true,
          enabled: false,
          message: 'Follow mode disabled',
        });
      }

      logger.error('Error managing follow mode:', error);
      const gitError = error as GitError;
      return res.status(500).json({
        error: 'Failed to manage follow mode',
        details: gitError.stderr || gitError.message,
      });
    }
  });

  return router;
}
