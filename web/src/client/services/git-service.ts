/**
 * Git Service
 *
 * Handles Git-related API calls including repository info, worktrees, and follow mode
 */

import { createLogger } from '../utils/logger.js';
import type { AuthClient } from './auth-client.js';

const logger = createLogger('git-service');

export interface GitRepoInfo {
  isGitRepo: boolean;
  repoPath?: string;
}

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

export interface WorktreeListResponse {
  worktrees: Worktree[];
  baseBranch: string;
  followBranch?: string;
}

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
        method: 'POST',
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
        method: 'DELETE',
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
        method: 'POST',
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
        method: 'POST',
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
        method: 'POST',
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
