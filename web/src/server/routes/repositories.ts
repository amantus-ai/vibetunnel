import { Router } from 'express';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('repositories');

export interface DiscoveredRepository {
  id: string;
  path: string;
  folderName: string;
  lastModified: string;
  relativePath: string;
}

interface RepositorySearchOptions {
  basePath: string;
  maxDepth?: number;
}

/**
 * Create routes for repository discovery functionality
 */
export function createRepositoryRoutes(): Router {
  const router = Router();

  // Discover repositories endpoint
  router.get('/repositories/discover', async (req, res) => {
    try {
      const basePath = (req.query.path as string) || '~/';
      const maxDepth = Number.parseInt(req.query.maxDepth as string) || 3;

      logger.debug(`[GET /repositories/discover] Discovering repositories in: ${basePath}`);

      const expandedPath = resolvePath(basePath);
      logger.debug(`[GET /repositories/discover] Expanded path: ${expandedPath}`);

      // Check if the path exists
      try {
        await fs.access(expandedPath, fs.constants.R_OK);
        logger.debug(`[GET /repositories/discover] Path exists and is readable: ${expandedPath}`);
      } catch (error) {
        logger.error(`[GET /repositories/discover] Cannot access path: ${expandedPath}`, error);
      }

      const repositories = await discoverRepositories({
        basePath: expandedPath,
        maxDepth,
      });

      logger.debug(`[GET /repositories/discover] Found ${repositories.length} repositories`);
      res.json(repositories);
    } catch (error) {
      logger.error('[GET /repositories/discover] Error discovering repositories:', error);
      res.status(500).json({ error: 'Failed to discover repositories' });
    }
  });

  return router;
}

/**
 * Resolve path handling ~ expansion
 */
function resolvePath(inputPath: string): string {
  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(inputPath);
}

/**
 * Discover git repositories in the specified base path
 */
async function discoverRepositories(
  options: RepositorySearchOptions
): Promise<DiscoveredRepository[]> {
  const { basePath, maxDepth = 3 } = options;
  const repositories: DiscoveredRepository[] = [];

  logger.debug(`Starting repository discovery in ${basePath} with maxDepth=${maxDepth}`);

  async function scanDirectory(dirPath: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return;
    }

    try {
      // Check if directory is accessible
      await fs.access(dirPath, fs.constants.R_OK);

      // First check if the current directory itself is a git repository
      // Only check at depth 0 to match Mac app behavior
      if (depth === 0) {
        const currentGitPath = path.join(dirPath, '.git');
        try {
          await fs.access(currentGitPath, fs.constants.F_OK);
          // Current directory is a git repository
          const repository = await createDiscoveredRepository(dirPath);
          repositories.push(repository);
          logger.debug(`Found git repository at base path: ${dirPath}`);
          // Don't scan subdirectories of a git repository
          return;
        } catch {
          // Current directory is not a git repository, continue scanning
        }
      }

      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        // Skip hidden directories except .git
        if (entry.name.startsWith('.') && entry.name !== '.git') continue;

        const fullPath = path.join(dirPath, entry.name);

        // Check if this subdirectory is a git repository
        const gitPath = path.join(fullPath, '.git');
        try {
          await fs.access(gitPath, fs.constants.F_OK);
          // If .git exists (either as a file or directory), this is a git repository
          const repository = await createDiscoveredRepository(fullPath);
          repositories.push(repository);
          logger.debug(`Found git repository: ${fullPath}`);
          // Don't scan subdirectories of a git repository
        } catch {
          // .git doesn't exist, scan subdirectories
          await scanDirectory(fullPath, depth + 1);
        }
      }
    } catch (error) {
      logger.debug(`Cannot access directory ${dirPath}:`, error);
    }
  }

  await scanDirectory(basePath, 0);

  // Sort by folder name
  repositories.sort((a, b) => a.folderName.localeCompare(b.folderName));

  return repositories;
}

/**
 * Create a DiscoveredRepository from a path
 */
async function createDiscoveredRepository(repoPath: string): Promise<DiscoveredRepository> {
  const folderName = path.basename(repoPath);

  // Get last modified date
  const stats = await fs.stat(repoPath);
  const lastModified = stats.mtime.toISOString();

  // Get relative path from home directory
  const homeDir = os.homedir();
  const relativePath = repoPath.startsWith(homeDir)
    ? `~${repoPath.slice(homeDir.length)}`
    : repoPath;

  return {
    id: `${folderName}-${stats.ino}`,
    path: repoPath,
    folderName,
    lastModified,
    relativePath,
  };
}
