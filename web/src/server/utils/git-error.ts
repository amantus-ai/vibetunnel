/**
 * Git command error with additional context
 */
export interface GitError extends Error {
  code?: string;
  stderr?: string;
  exitCode?: number;
}

/**
 * Type guard to check if an error is a GitError
 */
export function isGitError(error: unknown): error is GitError {
  return (
    error instanceof Error &&
    (typeof (error as GitError).code === 'string' ||
      typeof (error as GitError).stderr === 'string' ||
      typeof (error as GitError).exitCode === 'number')
  );
}

/**
 * Create a GitError from an unknown error
 */
export function createGitError(error: unknown, context?: string): GitError {
  const gitError = new Error(
    context
      ? `${context}: ${error instanceof Error ? error.message : String(error)}`
      : error instanceof Error
        ? error.message
        : String(error)
  ) as GitError;

  if (error instanceof Error) {
    // Copy standard Error properties
    gitError.stack = error.stack;
    gitError.name = error.name;

    // Copy Git-specific properties if they exist
    const errorWithProps = error as unknown as Record<string, unknown>;
    if (typeof errorWithProps.code === 'string') {
      gitError.code = errorWithProps.code;
    }
    if (typeof errorWithProps.stderr === 'string') {
      gitError.stderr = errorWithProps.stderr;
    } else if (errorWithProps.stderr && typeof errorWithProps.stderr === 'object') {
      // Handle Buffer or other objects that can be converted to string
      gitError.stderr = String(errorWithProps.stderr);
    }
    if (typeof errorWithProps.exitCode === 'number') {
      gitError.exitCode = errorWithProps.exitCode;
    }
  }

  return gitError;
}

/**
 * Check if a GitError indicates the git command was not found
 */
export function isGitNotFoundError(error: unknown): boolean {
  return isGitError(error) && error.code === 'ENOENT';
}

/**
 * Check if a GitError indicates we're not in a git repository
 */
export function isNotGitRepositoryError(error: unknown): boolean {
  return isGitError(error) && (error.stderr?.includes('not a git repository') ?? false);
}

/**
 * Check if a GitError is due to a missing config key
 */
export function isGitConfigNotFoundError(error: unknown): boolean {
  return isGitError(error) && error.exitCode === 5;
}
