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
   * Switch to a branch and enable follow mode
   */
  async switchBranch(repoPath: string, branch: string): Promise<void> {
    try {
      const response = await fetch('/api/worktrees/switch', {
        method: HttpMethod.POST,
        headers: {
          'Content-Type': 'application/json',
          ...this.authClient.getAuthHeader(),
        },
        body: JSON.stringify({ repoPath, branch }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || `Failed to switch branch: ${response.statusText}`);
      }
    } catch (error) {
      logger.error('Failed to switch branch:', error);
      throw error;
    }
  }

  /**
   * Enable or disable follow mode
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
