import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { createLogger } from './logger.js';

const logger = createLogger('git-utils');
const readFile = promisify(fs.readFile);
const stat = promisify(fs.stat);
const execFile = promisify(require('child_process').execFile);

/**
 * Get the main repository path for a given path
 * @param gitPath Path that might be a worktree or main repo
 * @returns Main repository path
 */
export async function getMainRepositoryPath(gitPath: string): Promise<string> {
  try {
    const gitFile = path.join(gitPath, '.git');
    const stats = await stat(gitFile).catch(() => null);

    if (!stats) {
      // Not a git repository
      return gitPath;
    }

    if (stats.isDirectory()) {
      // This is the main repository
      return gitPath;
    }

    // This is a worktree - read the .git file to find the main repo
    const gitFileContent = await readFile(gitFile, 'utf-8');
    const match = gitFileContent.match(/^gitdir:\s*(.+)$/m);

    if (!match) {
      logger.warn(`Could not parse .git file at ${gitFile}`);
      return gitPath;
    }

    // Extract main repo path from worktree path
    // Example: /Users/steipete/Projects/vibetunnel/.git/worktrees/vibetunnel-treetest
    // We want: /Users/steipete/Projects/vibetunnel
    const worktreePath = match[1].trim();
    const mainRepoMatch = worktreePath.match(/^(.+)\/.git\/worktrees\/.+$/);

    if (mainRepoMatch) {
      return mainRepoMatch[1];
    }

    // Fallback: try to resolve it using git command
    try {
      const { stdout } = await execFile('git', ['rev-parse', '--git-common-dir'], {
        cwd: gitPath,
      });
      const commonDir = stdout.trim();
      // Go up one level from .git directory
      return path.dirname(commonDir);
    } catch (error) {
      logger.warn(`Could not determine main repo path for ${gitPath}:`, error);
      return gitPath;
    }
  } catch (error) {
    logger.error(`Error getting main repository path for ${gitPath}:`, error);
    return gitPath;
  }
}

/**
 * Check if a path is a git worktree
 * @param gitPath Path to check
 * @returns True if the path is a worktree
 */
export async function isWorktree(gitPath: string): Promise<boolean> {
  try {
    const gitFile = path.join(gitPath, '.git');
    const stats = await stat(gitFile).catch(() => null);

    if (!stats) {
      return false;
    }

    // If .git is a file (not a directory), it's a worktree
    return !stats.isDirectory();
  } catch (error) {
    logger.error(`Error checking if path is worktree: ${gitPath}`, error);
    return false;
  }
}
