/**
 * Git-related utility functions for session creation
 */

import { HttpMethod } from '../../../shared/types.js';
import type { AuthClient } from '../../services/auth-client.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('git-utils');

export interface BranchInfo {
  name: string;
  current: boolean;
}

export async function loadBranches(
  repoPath: string,
  authClient: AuthClient
): Promise<{ branches: string[]; currentBranch: string | null }> {
  try {
    const response = await fetch(
      `/api/repositories/branches?${new URLSearchParams({ path: repoPath })}`,
      {
        headers: authClient.getAuthHeader(),
      }
    );

    if (response.ok) {
      const branches: BranchInfo[] = await response.json();
      const branchNames = branches.map((b) => b.name);
      const currentBranch = branches.find((b) => b.current)?.name || null;

      return { branches: branchNames, currentBranch };
    } else {
      logger.error('Failed to load branches:', response.statusText);
      return { branches: [], currentBranch: null };
    }
  } catch (error) {
    logger.error('Failed to load branches:', error);
    return { branches: [], currentBranch: null };
  }
}

export async function checkFollowMode(
  repoPath: string,
  authClient: AuthClient
): Promise<{ followMode: boolean; followBranch: string | null }> {
  try {
    const response = await fetch(`/api/git/follow?${new URLSearchParams({ path: repoPath })}`, {
      headers: authClient.getAuthHeader(),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        followMode: data.followMode || false,
        followBranch: data.followBranch || null,
      };
    } else {
      logger.error('Failed to check follow mode:', response.statusText);
      return { followMode: false, followBranch: null };
    }
  } catch (error) {
    logger.error('Failed to check follow mode:', error);
    return { followMode: false, followBranch: null };
  }
}

export async function enableFollowMode(
  repoPath: string,
  branch: string,
  authClient: AuthClient
): Promise<boolean> {
  try {
    const response = await fetch('/api/worktrees/follow', {
      method: HttpMethod.POST,
      headers: {
        ...authClient.getAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        repoPath,
        branch,
        enable: true,
      }),
    });

    if (!response.ok) {
      logger.error('Failed to enable follow mode:', response.statusText);
      return false;
    }

    logger.log('Follow mode enabled successfully');
    return true;
  } catch (error) {
    logger.error('Error enabling follow mode:', error);
    return false;
  }
}

export function generateWorktreePath(repoPath: string, branchName: string): string {
  const branchSlug = branchName.trim().replace(/[^a-zA-Z0-9-_]/g, '-');
  return `${repoPath}-${branchSlug}`;
}
