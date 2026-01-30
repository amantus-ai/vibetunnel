/**
 * Git Service
 *
 * Handles Git-related API calls including repository info, worktrees, and follow mode.
 * This service provides a client-side interface to interact with Git repositories
 * through the VibeTunnel server API.
 *
 * ## Main Features
 * - Repository detection and status checking
 * - Git worktree management (list, create, delete, prune)
 * - Branch switching with follow mode support
 * - Repository change detection
 *
 * ## Usage Example
 * ```typescript
 * const gitService = new GitService(authClient);
 *
 * // Check if current path is a git repository
 * const repoInfo = await gitService.checkGitRepo('/path/to/project');
 * if (repoInfo.isGitRepo) {
 *   // List all worktrees
 *   const { worktrees } = await gitService.listWorktrees(repoInfo.repoPath);
 *
 *   // Create a new worktree
 *   await gitService.createWorktree(
 *     repoInfo.repoPath,
 *     'feature/new-branch',
 *     '/path/to/worktree'
 *   );
 * }
 * ```
 *
 * @see web/src/server/controllers/git-controller.ts for server-side implementation
 * @see web/src/server/controllers/worktree-controller.ts for worktree endpoints
 */

import { HttpMethod } from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';
import type { AuthClient } from './auth-client.js';

const logger = createLogger('git-service');

/**
 * Git repository information
 *
 * @property isGitRepo - Whether the path is within a Git repository
 * @property repoPath - Absolute path to the repository root (if isGitRepo is true)
 * @property hasChanges - Whether the repository has uncommitted changes
 * @property isWorktree - Whether the current path is a Git worktree (not the main repository)
 */
export interface GitRepoInfo {
  isGitRepo: boolean;
  repoPath?: string;
  hasChanges?: boolean;
  isWorktree?: boolean;
}

/**
 * Git worktree information
 *
 * A worktree allows you to have multiple working directories attached to the same repository.
 * Each worktree has its own working directory and can check out a different branch.
 *
 * @property path - Absolute path to the worktree directory
 * @property branch - Branch name checked out in this worktree
 * @property HEAD - Current commit SHA
 * @property detached - Whether HEAD is detached (not on a branch)
 * @property prunable - Whether this worktree can be pruned (directory missing)
 * @property locked - Whether this worktree is locked (prevents deletion)
 * @property lockedReason - Reason why the worktree is locked
 *
 * Extended statistics (populated by the server):
 * @property commitsAhead - Number of commits ahead of the base branch
 * @property filesChanged - Number of files with changes
 * @property insertions - Number of lines added
 * @property deletions - Number of lines removed
 * @property hasUncommittedChanges - Whether there are uncommitted changes
 *
 * UI helper properties:
 * @property isMainWorktree - Whether this is the main worktree (not a linked worktree)
 * @property isCurrentWorktree - Whether this worktree matches the current session path
 */
export interface Worktree {
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
  // UI helpers
  isMainWorktree?: boolean;
  isCurrentWorktree?: boolean;
}

/**
 * Response from listing worktrees
 *
 * @property worktrees - Array of all worktrees for the repository
 * @property baseBranch - The default/main branch of the repository (e.g., 'main' or 'master')
 * @property followBranch - Currently active branch for follow mode (if any)
 */
export interface WorktreeListResponse {
  worktrees: Worktree[];
  baseBranch: string;
  followBranch?: string;
}

/**
 * GitService provides client-side methods for interacting with Git repositories
 * through the VibeTunnel API. All methods require authentication via AuthClient.
 *
 * The service handles:
 * - Error logging and propagation
 * - Authentication headers
 * - Request/response serialization
 * - URL encoding for path parameters
 */
export class GitService {
  constructor(private authClient: AuthClient) {}

  /**
   * Check if a path is within a Git repository
   *
   * This method determines if the given path is part of a Git repository and
   * provides additional information about the repository state.
   *
   * @param path - Absolute path to check (e.g., '/Users/alice/projects/myapp')
   * @returns Promise resolving to repository information
   *
   * @example
   * ```typescript
   * const info = await gitService.checkGitRepo('/Users/alice/projects/myapp');
   * if (info.isGitRepo) {
   *   console.log(`Repository at: ${info.repoPath}`);
   *   console.log(`Has changes: ${info.hasChanges}`);
   * }
   * ```
   *
   * @throws Error if the API request fails
   */
  async checkGitRepo(path: string): Promise<GitRepoInfo> {
    try {
      const response = await fetch(`/api/git/repo-info?path=${encodeURIComponent(path)}`, {
        headers: this.authClient.getAuthHeader(),
      });
      if (!response.ok) {
        throw new Error(`Failed to check git repo: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      logger.error('Failed to check git repo:', error);
      throw error;
    }
  }

  /**
   * List all worktrees for a repository
   *
   * Retrieves information about all worktrees associated with the repository,
   * including their branches, paths, and change statistics.
   *
   * @param repoPath - Absolute path to the repository root
   * @returns Promise resolving to worktree list with base branch and follow mode info
   *
   * @example
   * ```typescript
   * const { worktrees, baseBranch } = await gitService.listWorktrees('/path/to/repo');
   *
   * // Find worktrees with uncommitted changes
   * const dirtyWorktrees = worktrees.filter(wt => wt.hasUncommittedChanges);
   *
   * // Check if a specific branch has a worktree
   * const hasBranch = worktrees.some(wt => wt.branch === 'feature/new-ui');
   * ```
   *
   * @throws Error if the API request fails or repository is invalid
   */
  async listWorktrees(repoPath: string): Promise<WorktreeListResponse> {
    try {
      const response = await fetch(`/api/worktrees?repoPath=${encodeURIComponent(repoPath)}`, {
        headers: this.authClient.getAuthHeader(),
      });
      if (!response.ok) {
        throw new Error(`Failed to list worktrees: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      logger.error('Failed to list worktrees:', error);
      throw error;
    }
  }

  /**
   * Create a new worktree
   *
   * Creates a new Git worktree linked to the repository. This allows you to
   * work on multiple branches simultaneously in different directories.
   *
   * @param repoPath - Absolute path to the repository root
   * @param branch - Branch name for the new worktree (will be created if doesn't exist)
   * @param path - Absolute path where the worktree should be created
   * @param baseBranch - Optional base branch to create the new branch from (defaults to repository's default branch)
   *
   * @example
   * ```typescript
   * // Create a worktree for a new feature branch
   * await gitService.createWorktree(
   *   '/Users/alice/myproject',
   *   'feature/dark-mode',
   *   '/Users/alice/myproject-dark-mode'
   * );
   *
   * // Create a worktree based on a specific branch
   * await gitService.createWorktree(
   *   '/Users/alice/myproject',
   *   'hotfix/security-patch',
   *   '/Users/alice/myproject-hotfix',
   *   'release/v2.0'
   * );
   * ```
   *
   * @throws Error if:
   * - The branch already has a worktree
   * - The target path already exists
   * - The repository path is invalid
   * - Git operation fails
   */
  async createWorktree(
    repoPath: string,
    branch: string,
    path: string,
    baseBranch?: string
  ): Promise<void> {
    try {
      const response = await fetch('/api/worktrees', {
        method: HttpMethod.POST,
        headers: {
          'Content-Type': 'application/json',
          ...this.authClient.getAuthHeader(),
        },
        body: JSON.stringify({ repoPath, branch, path, baseBranch }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || `Failed to create worktree: ${response.statusText}`);
      }
    } catch (error) {
      logger.error('Failed to create worktree:', error);
      throw error;
    }
  }

  /**
   * Delete a worktree
   *
   * Removes a worktree from the repository. The worktree directory will be
   * deleted and the branch association will be removed.
   *
   * @param repoPath - Absolute path to the repository root
   * @param branch - Branch name of the worktree to delete
   * @param force - Force deletion even if there are uncommitted changes (default: false)
   *
   * @example
   * ```typescript
   * // Safe delete (will fail if there are uncommitted changes)
   * await gitService.deleteWorktree('/path/to/repo', 'feature/old-feature');
   *
   * // Force delete (discards uncommitted changes)
   * await gitService.deleteWorktree('/path/to/repo', 'feature/old-feature', true);
   * ```
   *
   * @throws Error if:
   * - The worktree doesn't exist
   * - The worktree has uncommitted changes (unless force=true)
   * - The worktree is locked
   * - Attempting to delete the main worktree
   */
  async deleteWorktree(repoPath: string, branch: string, force = false): Promise<void> {
    try {
      const params = new URLSearchParams({ repoPath });
      if (force) params.append('force', 'true');

      const response = await fetch(`/api/worktrees/${encodeURIComponent(branch)}?${params}`, {
        method: HttpMethod.DELETE,
        headers: this.authClient.getAuthHeader(),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || `Failed to delete worktree: ${response.statusText}`);
      }
    } catch (error) {
      logger.error('Failed to delete worktree:', error);
      throw error;
    }
  }

  /**
   * Prune worktree information
   *
   * Cleans up worktree administrative data for worktrees whose directories
   * have been manually deleted. This is equivalent to `git worktree prune`.
   *
   * @param repoPath - Absolute path to the repository root
   *
   * @example
   * ```typescript
   * // Clean up after manually deleting worktree directories
   * await gitService.pruneWorktrees('/path/to/repo');
   *
   * // Typical workflow after manual cleanup
   * const { worktrees } = await gitService.listWorktrees('/path/to/repo');
   * const prunableCount = worktrees.filter(wt => wt.prunable).length;
   * if (prunableCount > 0) {
   *   await gitService.pruneWorktrees('/path/to/repo');
   *   console.log(`Pruned ${prunableCount} worktrees`);
   * }
   * ```
   *
   * @throws Error if the API request fails or repository is invalid
   */
  async pruneWorktrees(repoPath: string): Promise<void> {
    try {
      const response = await fetch('/api/worktrees/prune', {
        method: HttpMethod.POST,
        headers: {
          'Content-Type': 'application/json',
          ...this.authClient.getAuthHeader(),
        },
        body: JSON.stringify({ repoPath }),
      });
      if (!response.ok) {
        throw new Error(`Failed to prune worktrees: ${response.statusText}`);
      }
    } catch (error) {
      logger.error('Failed to prune worktrees:', error);
      throw error;
    }
  }

  /**
   * Enable or disable follow mode
   *
   * Controls automatic synchronization between the main repository and worktrees.
   * When follow mode is enabled for a branch, the main repository will automatically
   * checkout that branch whenever any of its worktrees perform a checkout operation.
   *
   * This feature uses Git hooks (post-checkout, post-commit) and stores state in
   * the Git config as `vibetunnel.followWorktree`.
   *
   * **Important behaviors:**
   * - Only one branch can have follow mode enabled at a time
   * - Follow mode is automatically disabled if uncommitted changes prevent switching
   * - Git hooks are installed automatically when accessing a repository
   * - The `vt git event` command handles the synchronization
   *
   * @param repoPath - Absolute path to the repository root
   * @param branch - Branch name to set follow mode for
   * @param enable - True to enable follow mode, false to disable
   *
   * @example
   * ```typescript
   * // Enable follow mode for main branch
   * await gitService.setFollowMode('/path/to/repo', 'main', true);
   * // Now when you checkout in any worktree, main repo follows to 'main'
   *
   * // Disable follow mode
   * await gitService.setFollowMode('/path/to/repo', 'main', false);
   *
   * // Switch follow mode to a different branch
   * await gitService.setFollowMode('/path/to/repo', 'main', false);
   * await gitService.setFollowMode('/path/to/repo', 'feature/ui', true);
   * ```
   *
   * @throws Error if the API request fails or parameters are invalid
   */
  async setFollowMode(repoPath: string, branch: string, enable: boolean): Promise<void> {
    try {
      const response = await fetch('/api/worktrees/follow', {
        method: HttpMethod.POST,
        headers: {
          'Content-Type': 'application/json',
          ...this.authClient.getAuthHeader(),
        },
        body: JSON.stringify({ repoPath, branch, enable }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || `Failed to set follow mode: ${response.statusText}`);
      }
    } catch (error) {
      logger.error('Failed to set follow mode:', error);
      throw error;
    }
  }
}
