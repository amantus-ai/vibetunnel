import { Router } from 'express';
import * as path from 'path';
import { promisify } from 'util';
import { SessionManager } from '../pty/session-manager.js';
import { createGitError, isGitNotFoundError, isNotGitRepositoryError } from '../utils/git-error.js';
import { isWorktree } from '../utils/git-utils.js';
import { createLogger } from '../utils/logger.js';
import { resolveAbsolutePath } from '../utils/path-utils.js';
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

// Store for pending notifications when macOS client is not connected
const pendingNotifications: Array<{
  timestamp: number;
  notification: {
    level: 'info' | 'error';
    title: string;
    message: string;
  };
}> = [];

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
      logger.info(`🔍 [git/repo-info] Received request for path: ${queryPath}`);

      if (!queryPath || typeof queryPath !== 'string') {
        logger.warn('❌ Missing or invalid path parameter');
        return res.status(400).json({
          error: 'Missing or invalid path parameter',
        });
      }

      // Resolve the path to absolute, expanding tilde if present
      const absolutePath = resolveAbsolutePath(queryPath);
      logger.info(`🔍 [git/repo-info] Resolved ${queryPath} to absolute path: ${absolutePath}`);

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

        logger.info(`✅ [git/repo-info] Path is in git repo: ${repoPath}`);
        return res.json(response);
      } catch (error) {
        // If git command fails, it's not a git repo
        if (isGitNotFoundError(error)) {
          logger.debug('Git command not found');
          return res.json({ isGitRepo: false });
        }

        // Git returns exit code 128 when not in a git repo
        if (isNotGitRepositoryError(error)) {
          logger.info(`❌ [git/repo-info] Path is not in a git repository: ${absolutePath}`);
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
      let followWorktree: string | undefined;
      let currentBranch: string | undefined;
      let followMode = false;
      let isMainRepo = false;
      let isWorktreeRepo = false;

      try {
        // Check if this is a worktree
        const { stdout: gitDirOutput } = await execGit(['rev-parse', '--git-dir'], {
          cwd: repoPath,
        });
        const gitDir = gitDirOutput.trim();
        isWorktreeRepo = gitDir.includes('/.git/worktrees/');

        // If this is a worktree, find the main repo
        let mainRepoPath = repoPath;
        if (isWorktreeRepo) {
          // Extract main repo from git dir (e.g., /path/to/main/.git/worktrees/branch)
          mainRepoPath = gitDir.replace(/\/\.git\/worktrees\/.*$/, '');
          logger.debug(`Worktree detected, main repo: ${mainRepoPath}`);
        } else {
          isMainRepo = true;
        }

        // Get follow worktree setting from main repo
        const { stdout: followWorktreeOutput } = await execGit(
          ['config', 'vibetunnel.followWorktree'],
          {
            cwd: mainRepoPath,
          }
        );
        followWorktree = followWorktreeOutput.trim();
        followMode = !!followWorktree;

        // Get current branch
        const { stdout: branchOutput } = await execGit(['branch', '--show-current'], {
          cwd: repoPath,
        });
        currentBranch = branchOutput.trim();
      } catch (error) {
        // Config not set or git command failed - follow mode is disabled
        logger.debug('Follow worktree check failed or not configured:', error);
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
      if (followMode && followWorktree) {
        logger.info(`Follow mode active: processing event from ${repoPath}`);

        // Determine which repo we're in and which direction to sync
        if (repoPath === followWorktree && isWorktreeRepo) {
          // Event from worktree - sync to main repo
          logger.info(`Syncing from worktree to main repo`);

          try {
            // Find the main repo path
            const { stdout: gitDirOutput } = await execGit(['rev-parse', '--git-dir'], {
              cwd: repoPath,
            });
            const gitDir = gitDirOutput.trim();
            const mainRepoPath = gitDir.replace(/\/\.git\/worktrees\/.*$/, '');

            // Get the current branch in worktree
            const { stdout: worktreeBranchOutput } = await execGit(['branch', '--show-current'], {
              cwd: repoPath,
            });
            const worktreeBranch = worktreeBranchOutput.trim();

            if (worktreeBranch) {
              // Sync main repo to worktree's branch
              logger.info(`Syncing main repo to branch: ${worktreeBranch}`);
              await execGit(['checkout', worktreeBranch], { cwd: mainRepoPath });

              // Pull latest changes in main repo
              await execGit(['pull', '--ff-only'], { cwd: mainRepoPath });

              // Send sync success notification
              const syncNotif = {
                level: 'info' as const,
                title: 'Main Repository Synced',
                message: `Main repository synced to branch '${worktreeBranch}'`,
              };

              if (controlUnixHandler.isMacAppConnected()) {
                const syncNotification = createControlEvent('system', 'notification', syncNotif);
                controlUnixHandler.sendToMac(syncNotification);
              } else {
                pendingNotifications.push({
                  timestamp: Date.now(),
                  notification: syncNotif,
                });
              }
            }
          } catch (error) {
            logger.error('Failed to sync from worktree to main:', error);

            // Send error notification
            const errorNotif = {
              level: 'error' as const,
              title: 'Sync Failed',
              message: `Failed to sync main repository: ${error instanceof Error ? error.message : 'Unknown error'}`,
            };

            if (controlUnixHandler.isMacAppConnected()) {
              const errorNotification = createControlEvent('system', 'notification', errorNotif);
              controlUnixHandler.sendToMac(errorNotification);
            } else {
              pendingNotifications.push({
                timestamp: Date.now(),
                notification: errorNotif,
              });
            }
          }
        } else if (isMainRepo && event === 'commit') {
          // Event from main repo (commit only) - sync to worktree
          logger.info(`Syncing commit from main repo to worktree`);

          try {
            // Pull latest changes in worktree
            await execGit(['pull', '--ff-only'], { cwd: followWorktree });

            // Send sync success notification
            const syncNotif = {
              level: 'info' as const,
              title: 'Worktree Synced',
              message: `Worktree synced with latest commits`,
            };

            if (controlUnixHandler.isMacAppConnected()) {
              const syncNotification = createControlEvent('system', 'notification', syncNotif);
              controlUnixHandler.sendToMac(syncNotification);
            } else {
              pendingNotifications.push({
                timestamp: Date.now(),
                notification: syncNotif,
              });
            }
          } catch (error) {
            logger.error('Failed to sync commit to worktree:', error);
          }
        } else if (isMainRepo && event === 'checkout') {
          // Branch switch in main repo - disable follow mode
          logger.info('Branch switched in main repo, disabling follow mode');

          try {
            await execGit(['config', '--local', '--unset', 'vibetunnel.followWorktree'], {
              cwd: repoPath,
            });

            followMode = false;
            followWorktree = undefined;

            // Send notification about follow mode being disabled
            const disableNotif = {
              level: 'info' as const,
              title: 'Follow Mode Disabled',
              message: `Follow mode disabled due to branch switch in main repository`,
            };

            if (controlUnixHandler.isMacAppConnected()) {
              const disableNotification = createControlEvent(
                'system',
                'notification',
                disableNotif
              );
              controlUnixHandler.sendToMac(disableNotification);
            } else {
              pendingNotifications.push({
                timestamp: Date.now(),
                notification: disableNotif,
              });
            }
          } catch (error) {
            logger.error('Failed to disable follow mode:', error);
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

      // Prepare notifications
      const notificationsToSend: Array<{
        level: 'info' | 'error';
        title: string;
        message: string;
      }> = [];

      // Add specific follow mode notifications
      if (followMode && followWorktree) {
        const worktreeName = path.basename(followWorktree);
        notificationsToSend.push({
          level: 'info',
          title: 'Follow Mode Active',
          message: `Following worktree '${worktreeName}' in ${path.basename(repoPath)}`,
        });
      }

      // Send notifications via Unix socket to Mac app if connected
      if (controlUnixHandler.isMacAppConnected()) {
        // Send repository changed event
        const controlMessage = createControlEvent('git', 'repository-changed', notification);
        controlUnixHandler.sendToMac(controlMessage);
        logger.debug('Sent git event notification to Mac app');

        // Send specific notifications
        for (const notif of notificationsToSend) {
          const notificationMessage = createControlEvent('system', 'notification', notif);
          controlUnixHandler.sendToMac(notificationMessage);
        }
      } else {
        // Store notifications for web UI when macOS client is not connected
        const now = Date.now();
        for (const notif of notificationsToSend) {
          pendingNotifications.push({
            timestamp: now,
            notification: notif,
          });
        }

        // Keep only notifications from the last 5 minutes
        const fiveMinutesAgo = now - 5 * 60 * 1000;
        while (
          pendingNotifications.length > 0 &&
          pendingNotifications[0].timestamp < fiveMinutesAgo
        ) {
          pendingNotifications.shift();
        }

        logger.debug(`Stored ${notificationsToSend.length} notifications for web UI`);
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

  /**
   * GET /api/git/notifications
   * Get pending notifications for the web UI
   */
  router.get('/git/notifications', async (_req, res) => {
    try {
      // Clean up old notifications (older than 5 minutes)
      const now = Date.now();
      const fiveMinutesAgo = now - 5 * 60 * 1000;
      while (
        pendingNotifications.length > 0 &&
        pendingNotifications[0].timestamp < fiveMinutesAgo
      ) {
        pendingNotifications.shift();
      }

      // Return current notifications and clear them
      const notifications = pendingNotifications.map((n) => n.notification);
      pendingNotifications.length = 0;

      logger.debug(`Returning ${notifications.length} pending notifications`);
      res.json({ notifications });
    } catch (error) {
      logger.error('Error fetching notifications:', error);
      return res.status(500).json({
        error: 'Failed to fetch notifications',
      });
    }
  });

  /**
   * GET /api/git/status
   * Get repository status with file counts and branch info
   */
  router.get('/git/status', async (req, res) => {
    try {
      const { path: queryPath } = req.query;

      if (!queryPath || typeof queryPath !== 'string') {
        return res.status(400).json({
          error: 'Missing or invalid path parameter',
        });
      }

      // Resolve the path to absolute
      const absolutePath = resolveAbsolutePath(queryPath);
      logger.debug(`Getting git status for path: ${absolutePath}`);

      try {
        // Get repository root
        const { stdout: repoPathOutput } = await execGit(['rev-parse', '--show-toplevel'], {
          cwd: absolutePath,
        });
        const repoPath = repoPathOutput.trim();

        // Get current branch
        const { stdout: branchOutput } = await execGit(['branch', '--show-current'], {
          cwd: repoPath,
        });
        const currentBranch = branchOutput.trim();

        // Get status in porcelain format
        const { stdout: statusOutput } = await execGit(['status', '--porcelain=v1'], {
          cwd: repoPath,
        });

        // Parse status output
        const lines = statusOutput
          .trim()
          .split('\n')
          .filter((line) => line.length > 0);
        let modifiedCount = 0;
        let untrackedCount = 0;
        let stagedCount = 0;
        let addedCount = 0;
        let deletedCount = 0;

        for (const line of lines) {
          if (line.length < 2) continue;

          const indexStatus = line[0];
          const workTreeStatus = line[1];

          // Staged changes
          if (indexStatus !== ' ' && indexStatus !== '?') {
            stagedCount++;

            // Count specific types of staged changes
            if (indexStatus === 'A') {
              addedCount++;
            } else if (indexStatus === 'D') {
              deletedCount++;
            }
          }

          // Working tree changes
          if (workTreeStatus === 'M') {
            modifiedCount++;
          } else if (workTreeStatus === 'D' && indexStatus === ' ') {
            // Deleted in working tree but not staged
            deletedCount++;
          }

          // Untracked files
          if (indexStatus === '?' && workTreeStatus === '?') {
            untrackedCount++;
          }
        }

        // Get ahead/behind counts
        let aheadCount = 0;
        let behindCount = 0;
        let hasUpstream = false;

        try {
          // Check if we have an upstream branch
          const { stdout: upstreamOutput } = await execGit(
            ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
            { cwd: repoPath }
          );

          if (upstreamOutput.trim()) {
            hasUpstream = true;

            // Get ahead/behind counts
            const { stdout: aheadBehindOutput } = await execGit(
              ['rev-list', '--left-right', '--count', 'HEAD...@{u}'],
              { cwd: repoPath }
            );

            const [ahead, behind] = aheadBehindOutput
              .trim()
              .split('\t')
              .map((n) => Number.parseInt(n, 10));
            aheadCount = ahead || 0;
            behindCount = behind || 0;
          }
        } catch (_error) {
          // No upstream branch configured
          logger.debug('No upstream branch configured');
        }

        return res.json({
          isGitRepo: true,
          repoPath,
          currentBranch,
          hasChanges: lines.length > 0,
          modifiedCount,
          untrackedCount,
          stagedCount,
          addedCount,
          deletedCount,
          aheadCount,
          behindCount,
          hasUpstream,
        });
      } catch (error) {
        if (isNotGitRepositoryError(error)) {
          return res.json({
            isGitRepo: false,
          });
        }
        throw error;
      }
    } catch (error) {
      logger.error('Error getting git status:', error);
      return res.status(500).json({
        error: 'Failed to get git status',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * GET /api/git/remote
   * Get remote URL for a repository
   */
  router.get('/git/remote', async (req, res) => {
    try {
      const { path: queryPath } = req.query;

      if (!queryPath || typeof queryPath !== 'string') {
        return res.status(400).json({
          error: 'Missing or invalid path parameter',
        });
      }

      // Resolve the path to absolute
      const absolutePath = resolveAbsolutePath(queryPath);
      logger.debug(`Getting git remote for path: ${absolutePath}`);

      try {
        // Get repository root
        const { stdout: repoPathOutput } = await execGit(['rev-parse', '--show-toplevel'], {
          cwd: absolutePath,
        });
        const repoPath = repoPathOutput.trim();

        // Get remote URL
        const { stdout: remoteOutput } = await execGit(['remote', 'get-url', 'origin'], {
          cwd: repoPath,
        });
        const remoteUrl = remoteOutput.trim();

        // Parse GitHub URL from remote URL
        let githubUrl: string | null = null;
        if (remoteUrl) {
          // Handle HTTPS URLs: https://github.com/user/repo.git
          if (remoteUrl.startsWith('https://github.com/')) {
            githubUrl = remoteUrl.endsWith('.git') ? remoteUrl.slice(0, -4) : remoteUrl;
          }
          // Handle SSH URLs: git@github.com:user/repo.git
          else if (remoteUrl.startsWith('git@github.com:')) {
            const pathPart = remoteUrl.substring('git@github.com:'.length);
            const cleanPath = pathPart.endsWith('.git') ? pathPart.slice(0, -4) : pathPart;
            githubUrl = `https://github.com/${cleanPath}`;
          }
        }

        return res.json({
          isGitRepo: true,
          repoPath,
          remoteUrl,
          githubUrl,
        });
      } catch (error) {
        if (isNotGitRepositoryError(error)) {
          return res.json({
            isGitRepo: false,
          });
        }

        // Check if it's just missing remote
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('No such remote')) {
          return res.json({
            isGitRepo: true,
            remoteUrl: null,
            githubUrl: null,
          });
        }

        throw error;
      }
    } catch (error) {
      logger.error('Error getting git remote:', error);
      return res.status(500).json({
        error: 'Failed to get git remote',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * GET /api/git/repository-info
   * Get comprehensive repository information (combines multiple git commands)
   */
  router.get('/git/repository-info', async (req, res) => {
    try {
      const { path: queryPath } = req.query;

      if (!queryPath || typeof queryPath !== 'string') {
        return res.status(400).json({
          error: 'Missing or invalid path parameter',
        });
      }

      // Resolve the path to absolute
      const absolutePath = resolveAbsolutePath(queryPath);
      logger.debug(`Getting comprehensive git info for path: ${absolutePath}`);

      try {
        // Get repository root
        const { stdout: repoPathOutput } = await execGit(['rev-parse', '--show-toplevel'], {
          cwd: absolutePath,
        });
        const repoPath = repoPathOutput.trim();

        // Check if this is a worktree
        const worktreeStatus = await isWorktree(repoPath);

        // Gather all information in parallel
        const [branchResult, statusResult, remoteResult, aheadBehindResult] =
          await Promise.allSettled([
            // Current branch
            execGit(['branch', '--show-current'], { cwd: repoPath }),
            // Status
            execGit(['status', '--porcelain=v1'], { cwd: repoPath }),
            // Remote URL
            execGit(['remote', 'get-url', 'origin'], { cwd: repoPath }),
            // Ahead/behind counts
            execGit(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], { cwd: repoPath }),
          ]);

        // Process results
        const currentBranch =
          branchResult.status === 'fulfilled' ? branchResult.value.stdout.trim() : null;

        // Parse status
        let modifiedCount = 0;
        let untrackedCount = 0;
        let stagedCount = 0;
        let addedCount = 0;
        let deletedCount = 0;
        let hasChanges = false;

        if (statusResult.status === 'fulfilled') {
          const lines = statusResult.value.stdout
            .trim()
            .split('\n')
            .filter((line) => line.length > 0);
          hasChanges = lines.length > 0;

          for (const line of lines) {
            if (line.length < 2) continue;

            const indexStatus = line[0];
            const workTreeStatus = line[1];

            if (indexStatus !== ' ' && indexStatus !== '?') {
              stagedCount++;

              if (indexStatus === 'A') {
                addedCount++;
              } else if (indexStatus === 'D') {
                deletedCount++;
              }
            }

            if (workTreeStatus === 'M') {
              modifiedCount++;
            } else if (workTreeStatus === 'D' && indexStatus === ' ') {
              deletedCount++;
            }

            if (indexStatus === '?' && workTreeStatus === '?') {
              untrackedCount++;
            }
          }
        }

        // Remote URL
        const remoteUrl =
          remoteResult.status === 'fulfilled' ? remoteResult.value.stdout.trim() : null;

        // Parse GitHub URL from remote URL
        let githubUrl: string | null = null;
        if (remoteUrl) {
          // Handle HTTPS URLs: https://github.com/user/repo.git
          if (remoteUrl.startsWith('https://github.com/')) {
            githubUrl = remoteUrl.endsWith('.git') ? remoteUrl.slice(0, -4) : remoteUrl;
          }
          // Handle SSH URLs: git@github.com:user/repo.git
          else if (remoteUrl.startsWith('git@github.com:')) {
            const pathPart = remoteUrl.substring('git@github.com:'.length);
            const cleanPath = pathPart.endsWith('.git') ? pathPart.slice(0, -4) : pathPart;
            githubUrl = `https://github.com/${cleanPath}`;
          }
        }

        // Ahead/behind counts
        let aheadCount = 0;
        let behindCount = 0;
        let hasUpstream = false;

        if (aheadBehindResult.status === 'fulfilled') {
          hasUpstream = true;
          const [ahead, behind] = aheadBehindResult.value.stdout
            .trim()
            .split('\t')
            .map((n) => Number.parseInt(n, 10));
          aheadCount = ahead || 0;
          behindCount = behind || 0;
        }

        return res.json({
          isGitRepo: true,
          repoPath,
          currentBranch,
          remoteUrl,
          githubUrl,
          hasChanges,
          modifiedCount,
          untrackedCount,
          stagedCount,
          addedCount,
          deletedCount,
          aheadCount,
          behindCount,
          hasUpstream,
          isWorktree: worktreeStatus,
        });
      } catch (error) {
        if (isNotGitRepositoryError(error)) {
          return res.json({
            isGitRepo: false,
          });
        }
        throw error;
      }
    } catch (error) {
      logger.error('Error getting repository info:', error);
      return res.status(500).json({
        error: 'Failed to get repository info',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
