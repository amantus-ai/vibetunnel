/**
 * Mock Git Service for Testing
 *
 * Provides a mock implementation of GitService for unit tests
 */

import type {
  GitBranch,
  GitService,
  Worktree,
  WorktreeListResponse,
} from '../../client/services/git-service.js';

export interface MockWorktreeOptions {
  path: string;
  branch: string;
  HEAD?: string;
  detached?: boolean;
  prunable?: boolean;
  locked?: boolean;
  lockedReason?: string;
  isMainWorktree?: boolean;
  isCurrentWorktree?: boolean;
  hasUncommittedChanges?: boolean;
  commitsAhead?: number;
  filesChanged?: number;
}

export class MockGitService implements GitService {
  private worktrees: Map<string, Worktree[]> = new Map();
  private branches: Map<string, GitBranch[]> = new Map();
  private followBranches: Map<string, string | undefined> = new Map();
  private currentBranches: Map<string, string> = new Map();

  // Mock data setup methods
  setWorktrees(repoPath: string, worktrees: MockWorktreeOptions[]): void {
    this.worktrees.set(
      repoPath,
      worktrees.map((w) => ({
        path: w.path,
        branch: w.branch,
        HEAD: w.HEAD || 'abc123',
        detached: w.detached || false,
        prunable: w.prunable,
        locked: w.locked,
        lockedReason: w.lockedReason,
        isMainWorktree: w.isMainWorktree || false,
        isCurrentWorktree: w.isCurrentWorktree || false,
        hasUncommittedChanges: w.hasUncommittedChanges || false,
        commitsAhead: w.commitsAhead || 0,
        filesChanged: w.filesChanged || 0,
        insertions: 0,
        deletions: 0,
        stats: {
          commitsAhead: w.commitsAhead || 0,
          filesChanged: w.filesChanged || 0,
          insertions: 0,
          deletions: 0,
        },
      }))
    );
  }

  setBranches(repoPath: string, branches: string[]): void {
    this.branches.set(
      repoPath,
      branches.map((name) => ({
        name,
        current: this.currentBranches.get(repoPath) === name,
        remote: false,
      }))
    );
  }

  setCurrentBranch(repoPath: string, branch: string): void {
    this.currentBranches.set(repoPath, branch);
  }

  setFollowBranch(repoPath: string, branch: string | undefined): void {
    this.followBranches.set(repoPath, branch);
  }

  // GitService interface implementation
  async listWorktrees(repoPath: string): Promise<WorktreeListResponse> {
    const worktrees = this.worktrees.get(repoPath) || [];
    const baseBranch = 'main';
    const followBranch = this.followBranches.get(repoPath);

    return {
      worktrees,
      baseBranch,
      followBranch,
    };
  }

  async switchBranch(repoPath: string, branch: string): Promise<void> {
    // Check if branch exists
    const branches = this.branches.get(repoPath) || [];
    const branchExists = branches.some((b) => b.name === branch);
    if (!branchExists) {
      throw new Error(`Branch ${branch} does not exist`);
    }

    // Check for uncommitted changes
    const worktrees = this.worktrees.get(repoPath) || [];
    const mainWorktree = worktrees.find((w) => w.isMainWorktree);
    if (mainWorktree?.hasUncommittedChanges) {
      throw new Error('Cannot switch branches with uncommitted changes');
    }

    // Update current branch
    this.setCurrentBranch(repoPath, branch);

    // Update worktree current branch
    const updatedWorktrees = worktrees.map((w) => ({
      ...w,
      branch: w.isMainWorktree ? branch : w.branch,
    }));
    this.worktrees.set(repoPath, updatedWorktrees);
  }

  async deleteWorktree(repoPath: string, branch: string, force: boolean): Promise<void> {
    const worktrees = this.worktrees.get(repoPath) || [];
    const worktree = worktrees.find((w) => w.branch === branch);

    if (!worktree) {
      throw new Error(`Worktree for branch ${branch} not found`);
    }

    if (!force && worktree.hasUncommittedChanges) {
      throw new Error('Worktree has uncommitted changes');
    }

    // Remove the worktree
    const updatedWorktrees = worktrees.filter((w) => w.branch !== branch);
    this.worktrees.set(repoPath, updatedWorktrees);
  }

  async listBranches(repoPath: string): Promise<GitBranch[]> {
    return this.branches.get(repoPath) || [];
  }

  async setFollowMode(repoPath: string, branch: string, enable: boolean): Promise<void> {
    if (enable) {
      this.setFollowBranch(repoPath, branch);
    } else {
      this.setFollowBranch(repoPath, undefined);
    }
  }

  async isGitRepository(path: string): Promise<boolean> {
    // Simple mock: check if we have data for this path
    return this.worktrees.has(path) || this.branches.has(path);
  }

  async getRepositoryRoot(path: string): Promise<string | null> {
    // Simple mock: return the path if it's a known repo
    if (this.isGitRepository(path)) {
      return path;
    }
    return null;
  }

  async getCurrentBranch(repoPath: string): Promise<string | null> {
    return this.currentBranches.get(repoPath) || null;
  }

  async hasUncommittedChanges(repoPath: string): Promise<boolean> {
    const worktrees = this.worktrees.get(repoPath) || [];
    const mainWorktree = worktrees.find((w) => w.isMainWorktree);
    return mainWorktree?.hasUncommittedChanges || false;
  }

  async getRemoteUrl(_repoPath: string, _remote: string = 'origin'): Promise<string | null> {
    // Mock implementation
    return `https://github.com/example/repo.git`;
  }

  async addAllAndCommit(repoPath: string, _message: string): Promise<void> {
    // Mock implementation - clear uncommitted changes
    const worktrees = this.worktrees.get(repoPath) || [];
    const updatedWorktrees = worktrees.map((w) => ({
      ...w,
      hasUncommittedChanges: false,
    }));
    this.worktrees.set(repoPath, updatedWorktrees);
  }

  async push(_repoPath: string, _remote?: string, _branch?: string): Promise<void> {
    // Mock implementation - no-op
  }

  async fetch(_repoPath: string, _remote?: string): Promise<void> {
    // Mock implementation - no-op
  }

  async pull(_repoPath: string, _remote?: string, _branch?: string): Promise<void> {
    // Mock implementation - no-op
  }

  async createBranch(repoPath: string, branchName: string, _baseBranch?: string): Promise<void> {
    const branches = this.branches.get(repoPath) || [];
    branches.push({
      name: branchName,
      current: false,
      remote: false,
    });
    this.branches.set(repoPath, branches);
  }

  async deleteBranch(repoPath: string, branchName: string, _force: boolean = false): Promise<void> {
    const branches = this.branches.get(repoPath) || [];
    const updatedBranches = branches.filter((b) => b.name !== branchName);
    this.branches.set(repoPath, updatedBranches);
  }
}

/**
 * Create a mock Git service with default test data
 */
export function createMockGitService(): MockGitService {
  const service = new MockGitService();

  // Set up a default test repository
  const testRepoPath = '/test/repo';

  service.setWorktrees(testRepoPath, [
    {
      path: testRepoPath,
      branch: 'main',
      isMainWorktree: true,
      isCurrentWorktree: true,
    },
    {
      path: '/test/worktree-feature',
      branch: 'feature/test',
      commitsAhead: 3,
      filesChanged: 5,
    },
  ]);

  service.setBranches(testRepoPath, ['main', 'develop', 'feature/test']);
  service.setCurrentBranch(testRepoPath, 'main');

  return service;
}
