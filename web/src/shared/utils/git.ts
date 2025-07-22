/**
 * Git-related utility functions shared between client and server
 */

/**
 * Extract the base repository name from a path, handling common worktree patterns
 * @param repoPath Full path to the repository or worktree
 * @returns Base repository name without worktree suffixes
 *
 * Examples:
 * - /path/to/vibetunnel-treetest -> vibetunnel
 * - /path/to/myrepo-worktree -> myrepo
 * - /path/to/project-wt-feature -> project
 * - /path/to/normalrepo -> normalrepo
 */
export function getBaseRepoName(repoPath: string): string {
  // Extract the last part of the path
  const parts = repoPath.split('/');
  const lastPart = parts[parts.length - 1] || repoPath;

  // Handle common worktree patterns
  const worktreePatterns = [
    /-tree(?:test)?$/i, // -treetest, -tree
    /-worktree$/i, // -worktree
    /-wt-\w+$/i, // -wt-feature
    /-work$/i, // -work
    /-temp$/i, // -temp
    /-branch-\w+$/i, // -branch-feature
  ];

  for (const pattern of worktreePatterns) {
    if (pattern.test(lastPart)) {
      return lastPart.replace(pattern, '');
    }
  }

  return lastPart;
}
