import { Router } from 'express';
import * as path from 'path';
import { promisify } from 'util';
import { SessionManager } from '../pty/session-manager.js';
import { createGitError, isGitNotFoundError, isNotGitRepositoryError } from '../utils/git-error.js';
import { createLogger } from '../utils/logger.js';
import { createControlEvent } from '../websocket/control-protocol.js';
import { controlUnixHandler } from '../websocket/control-unix-handler.js';

const logger = createLogger('git-routes');
const execFile = promisify(require('child_process').execFile);

interface GitRepoInfo {
  isGitRepo: boolean;
  repoPath?: string;
}

interface GitEventRequest {
  repoPath: string;
  branch?: string;
  event?: 'checkout' | 'pull' | 'merge' | 'rebase' | 'commit' | 'push';
}

interface GitEventNotification {
  type: 'git-event';
  repoPath: string;
  branch?: string;
  event?: string;
  followMode?: boolean;
  sessionsUpdated: string[];
}

// In-memory lock to prevent race conditions
interface RepoLock {
  isLocked: boolean;
  queue: Array<() => void>;
}

const repoLocks = new Map<string, RepoLock>();

/**
 * Acquire a lock for a repository path
 * @param repoPath The repository path to lock
 * @returns A promise that resolves when the lock is acquired
 */
async function acquireRepoLock(repoPath: string): Promise<void> {
  return new Promise((resolve) => {
    let lock = repoLocks.get(repoPath);

    if (!lock) {
      lock = { isLocked: false, queue: [] };
      repoLocks.set(repoPath, lock);
    }

    if (!lock.isLocked) {
      lock.isLocked = true;
      resolve();
    } else {
      lock.queue.push(resolve);
    }
  });
}

/**
 * Release a lock for a repository path
 * @param repoPath The repository path to unlock
 */
function releaseRepoLock(repoPath: string): void {
  const lock = repoLocks.get(repoPath);

  if (!lock) {
    return;
  }

  if (lock.queue.length > 0) {
    const next = lock.queue.shift();
    if (next) {
      next();
    }
  } else {
    lock.isLocked = false;
  }
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
      timeout: options.timeout || 5000,
      maxBuffer: 1024 * 1024, // 1MB
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, // Disable git prompts
    });
    return { stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (error) {
    // Re-throw with more context
    throw createGitError(error, 'Git command failed');
  }
}

/**
 * Create Git-related routes
 */
export function createGitRoutes(): Router {
  const router = Router();

  /**
   * GET /api/git/repo-info
   * Check if a path is within a Git repository
   */
  router.get('/git/repo-info', async (req, res) => {
    try {
      const { path: queryPath } = req.query;

      if (!queryPath || typeof queryPath !== 'string') {
        return res.status(400).json({
          error: 'Missing or invalid path parameter',
        });
      }

      // Resolve the path to absolute
      const absolutePath = path.resolve(queryPath);
      logger.debug(`Checking if path is git repo: ${absolutePath}`);

      try {
        // Use git rev-parse to find the repository root
        const { stdout } = await execGit(['rev-parse', '--show-toplevel'], {
          cwd: absolutePath,
        });

        const repoPath = stdout.trim();

        const response: GitRepoInfo = {
          isGitRepo: true,
          repoPath,
        };

        logger.debug(`Path is in git repo: ${repoPath}`);
        return res.json(response);
      } catch (error) {
        // If git command fails, it's not a git repo
        if (isGitNotFoundError(error)) {
          logger.debug('Git command not found');
          return res.json({ isGitRepo: false });
        }

        // Git returns exit code 128 when not in a git repo
        if (isNotGitRepositoryError(error)) {
          logger.debug('Path is not in a git repository');
          return res.json({ isGitRepo: false });
        }

        // Unexpected error
        throw error;
      }
    } catch (error) {
      logger.error('Error checking git repo info:', error);
      return res.status(500).json({
        error: 'Failed to check git repository info',
      });
    }
  });

  /**
   * POST /api/git/event
   * Handle Git repository change events with locking to prevent race conditions
   */
  router.post('/git/event', async (req, res) => {
    let lockAcquired = false;
    let repoPath: string | undefined;

    try {
      const { repoPath: requestedRepoPath, branch, event } = req.body as GitEventRequest;

      if (!requestedRepoPath || typeof requestedRepoPath !== 'string') {
        return res.status(400).json({
          error: 'Missing or invalid repoPath parameter',
        });
      }

      // Normalize the repository path
      repoPath = path.resolve(requestedRepoPath);
      logger.debug(
        `Processing git event for repo: ${repoPath}, branch: ${branch}, event: ${event}`
      );

      // Acquire lock for this repository
      await acquireRepoLock(repoPath);
      lockAcquired = true;

      // Get all sessions and find those within the repository path
      const sessionManager = new SessionManager();
      const allSessions = sessionManager.listSessions();
      const sessionsInRepo = allSessions.filter((session) => {
        if (!session.workingDir || !repoPath) return false;
        const sessionPath = path.resolve(session.workingDir);
        return sessionPath.startsWith(repoPath);
      });

      logger.debug(`Found ${sessionsInRepo.length} sessions in repository ${repoPath}`);

      const updatedSessionIds: string[] = [];

      // Check follow mode status
      let followBranch: string | undefined;
      let currentBranch: string | undefined;
      let followMode = false;

      try {
        // Get follow branch setting
        const { stdout: followBranchOutput } = await execGit(
          ['config', 'vibetunnel.followBranch'],
          {
            cwd: repoPath,
          }
        );
        followBranch = followBranchOutput.trim();
        // Follow mode is active when a branch name is set (not just 'true')
        followMode = !!followBranch;

        // Get current branch
        const { stdout: branchOutput } = await execGit(['branch', '--show-current'], {
          cwd: repoPath,
        });
        currentBranch = branchOutput.trim();
      } catch (error) {
        // Config not set or git command failed - follow mode is disabled
        logger.debug('Follow branch check failed or not configured:', error);
      }

      // Extract repository name from path
      const _repoName = path.basename(repoPath);

      // Update session titles for all sessions in the repository
      for (const session of sessionsInRepo) {
        try {
          // Get the branch for this specific session's working directory
          let _sessionBranch = currentBranch;
          try {
            const { stdout: sessionBranchOutput } = await execGit(['branch', '--show-current'], {
              cwd: session.workingDir,
            });
            if (sessionBranchOutput.trim()) {
              _sessionBranch = sessionBranchOutput.trim();
            }
          } catch (_error) {
            // Use current branch as fallback
            logger.debug(`Could not get branch for session ${session.id}, using repo branch`);
          }

          // Extract base session name (remove any existing git info in square brackets at the end)
          // Use a more specific regex to only match git-related content in brackets
          const baseSessionName =
            session.name?.replace(
              /\s*\[(checkout|branch|merge|rebase|commit|push|pull|fetch|stash|reset|cherry-pick):[^\]]+\]\s*$/,
              ''
            ) || 'Terminal';

          // Construct new title with format: baseSessionName [event: branch]
          let newTitle = baseSessionName;
          if (event && branch) {
            newTitle = `${baseSessionName} [${event}: ${branch}]`;
          }

          // Update the session name
          sessionManager.updateSessionName(session.id, newTitle);
          updatedSessionIds.push(session.id);

          logger.debug(`Updated session ${session.id} title to: ${newTitle}`);
        } catch (error) {
          logger.error(`Failed to update session ${session.id}:`, error);
        }
      }

      // Handle follow mode sync logic
      if (
        followMode &&
        followBranch &&
        event === 'checkout' &&
        branch === followBranch &&
        currentBranch !== followBranch
      ) {
        logger.info(`Follow mode active: syncing from ${currentBranch} to ${followBranch}`);

        try {
          // Check if branches have diverged
          const { stdout: divergeCheck } = await execGit(
            ['rev-list', '--count', `${followBranch}..HEAD`],
            { cwd: repoPath }
          );

          const divergedCommits = Number.parseInt(divergeCheck.trim(), 10);

          if (divergedCommits > 0) {
            logger.warn(`Branch has diverged by ${divergedCommits} commits, disabling follow mode`);

            // Disable follow mode
            await execGit(['config', '--local', '--unset', 'vibetunnel.followBranch'], {
              cwd: repoPath,
            });

            followMode = false;
            followBranch = undefined;

            // Send notification about follow mode being disabled
            if (controlUnixHandler.isMacAppConnected()) {
              const divergeNotification = createControlEvent('system', 'notification', {
                level: 'error',
                title: 'Follow Mode Disabled',
                message: `Branches have diverged by ${divergedCommits} commits. Follow mode has been disabled.`,
              });
              controlUnixHandler.sendToMac(divergeNotification);
            }
          } else {
            // Perform the sync (checkout to the followed branch)
            logger.info(`Checking out branch: ${followBranch}`);
            await execGit(['checkout', followBranch], { cwd: repoPath });

            // Send sync success notification
            if (controlUnixHandler.isMacAppConnected()) {
              const syncNotification = createControlEvent('system', 'notification', {
                level: 'info',
                title: 'Repository Synced',
                message: `Successfully synced to branch '${followBranch}'`,
              });
              controlUnixHandler.sendToMac(syncNotification);
            }
          }
        } catch (error) {
          logger.error('Failed to sync branches:', error);

          // Disable follow mode on error
          try {
            await execGit(['config', '--local', '--unset', 'vibetunnel.followBranch'], {
              cwd: repoPath,
            });
            followMode = false;
            followBranch = undefined;

            // Send error notification
            if (controlUnixHandler.isMacAppConnected()) {
              const errorNotification = createControlEvent('system', 'notification', {
                level: 'error',
                title: 'Sync Failed',
                message: `Failed to sync repository: ${error instanceof Error ? error.message : 'Unknown error'}`,
              });
              controlUnixHandler.sendToMac(errorNotification);
            }
          } catch (configError) {
            logger.error('Failed to disable follow mode:', configError);
          }
        }
      }

      // Create notification payload
      const notification: GitEventNotification = {
        type: 'git-event',
        repoPath,
        branch: branch || currentBranch,
        event,
        followMode,
        sessionsUpdated: updatedSessionIds,
      };

      // Send notifications via Unix socket to Mac app
      if (controlUnixHandler.isMacAppConnected()) {
        // Send repository changed event
        const controlMessage = createControlEvent('git', 'repository-changed', notification);
        controlUnixHandler.sendToMac(controlMessage);
        logger.debug('Sent git event notification to Mac app');

        // Send specific follow mode notifications
        if (followMode && followBranch) {
          // Follow mode is active
          const followNotification = createControlEvent('system', 'notification', {
            level: 'info',
            title: 'Follow Mode Active',
            message: `Following branch '${followBranch}' in ${path.basename(repoPath)}`,
          });
          controlUnixHandler.sendToMac(followNotification);
        }
      }

      // Return success response
      res.json({
        success: true,
        repoPath,
        sessionsUpdated: updatedSessionIds.length,
        followMode,
        notification,
      });
    } catch (error) {
      logger.error('Error handling git event:', error);
      return res.status(500).json({
        error: 'Failed to process git event',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      // Always release the lock
      if (lockAcquired && repoPath) {
        releaseRepoLock(repoPath);
      }
    }
  });

  return router;
}
