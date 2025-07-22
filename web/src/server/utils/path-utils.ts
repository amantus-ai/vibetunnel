/**
 * Path utilities for server-side path operations
 */

import * as path from 'path';

/**
 * Expand tilde (~) in file paths to the user's home directory
 * @param filePath The path to expand
 * @returns The expanded path
 */
export function expandTildePath(filePath: string): string {
  if (!filePath || typeof filePath !== 'string') {
    return filePath;
  }

  if (filePath === '~' || filePath.startsWith('~/')) {
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    if (!homeDir) {
      // If we can't determine home directory, return original path
      return filePath;
    }
    return filePath === '~' ? homeDir : path.join(homeDir, filePath.slice(2));
  }

  return filePath;
}

/**
 * Resolve a path to an absolute path, expanding tilde if present
 * @param filePath The path to resolve
 * @returns The absolute path
 */
export function resolveAbsolutePath(filePath: string): string {
  const expanded = expandTildePath(filePath);
  return path.resolve(expanded);
}
