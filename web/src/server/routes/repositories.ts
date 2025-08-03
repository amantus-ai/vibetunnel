import { exec } from 'child_process';
import { Router } from 'express';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { DEFAULT_REPOSITORY_BASE_PATH } from '../../shared/constants.js';
import { createLogger } from '../utils/logger.js';
import { resolveAbsolutePath } from '../utils/path-utils.js';

const logger = createLogger('repositories');
const execAsync = promisify(exec);

export interface DiscoveredRepository {
  id: string;
  path: string;
  folderName: string;
  lastModified: string;
  relativePath: string;
  gitBranch?: string;
}

export interface Branch {
  name: string;
  current: boolean;
  remote: boolean;
  worktreePath?: string;
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

  // List branches for a repository
  router.get('/repositories/branches', async (req, res) => {
    try {
      const repoPath = req.query.path as string;

      if (!repoPath || typeof repoPath !== 'string') {
        return res.status(400).json({
          error: 'Missing or invalid path parameter',
        });
      }

      const expandedPath = resolveAbsolutePath(repoPath);
      logger.debug(`[GET /repositories/branches] Listing branches for: ${expandedPath}`);

      // Get all branches (local and remote)
      const branches = await listBranches(expandedPath);

      res.json(branches);
    } catch (error) {
      logger.error('[GET /repositories/branches] Error listing branches:', error);
      res.status(500).json({ error: 'Failed to list branches' });
    }
  });

  // Discover repositories endpoint
  router.get('/repositories/discover', async (req, res) => {
    try {
      const basePath = (req.query.path as string) || DEFAULT_REPOSITORY_BASE_PATH;
      const maxDepth = Number.parseInt(req.query.maxDepth as string) || 3;

      logger.debug(`[GET /repositories/discover] Discovering repositories in: ${basePath}`);

      const expandedPath = resolveAbsolutePath(basePath);
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
 * List all branches (local and remote) for a repository
 */
async function listBranches(repoPath: string): Promise<Branch[]> {
  const branches: Branch[] = [];

  try {
    // Get current branch
    let currentBranch: string | undefined;
    try {
      const { stdout } = await execAsync('git branch --show-current', { cwd: repoPath });
      currentBranch = stdout.trim();
    } catch {
      logger.debug('Failed to get current branch, repository might be in detached HEAD state');
    }

    // Get all local branches
    const { stdout: localBranchesOutput } = await execAsync('git branch', { cwd: repoPath });
    const localBranches = localBranchesOutput
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const isCurrent = line.startsWith('*');
        const name = line.replace(/^\*?\s+/, '');
        return {
          name,
          current: isCurrent || name === currentBranch,
          remote: false,
        };
      });

    branches.push(...localBranches);

    // Get all remote branches
    try {
      const { stdout: remoteBranchesOutput } = await execAsync('git branch -r', { cwd: repoPath });
      const remoteBranches = remoteBranchesOutput
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.includes('->')) // Skip HEAD pointers
        .map((line) => {
          const name = line.replace(/^\s+/, '');
          return {
            name,
            current: false,
            remote: true,
          };
        });

      branches.push(...remoteBranches);
    } catch {
      logger.debug('No remote branches found');
    }

    // Get worktree information
    try {
      const { stdout: worktreeOutput } = await execAsync('git worktree list --porcelain', {
        cwd: repoPath,
      });
      const worktrees = parseWorktreeList(worktreeOutput);

      // Add worktree information to branches
      for (const worktree of worktrees) {
        const branch = branches.find(
          (b) =>
            b.name === worktree.branch ||
            b.name === `refs/heads/${worktree.branch}` ||
            b.name.replace(/^origin\//, '') === worktree.branch
        );
        if (branch) {
          branch.worktreePath = worktree.path;
        }
      }
    } catch {
      logger.debug('Failed to get worktree information');
    }

    // Sort branches: current first, then local, then remote
    branches.sort((a, b) => {
      if (a.current && !b.current) return -1;
      if (!a.current && b.current) return 1;
      if (!a.remote && b.remote) return -1;
      if (a.remote && !b.remote) return 1;
      return a.name.localeCompare(b.name);
    });

    return branches;
  } catch (error) {
    logger.error('Error listing branches:', error);
    throw error;
  }
}

/**
 * Parse worktree list output
 */
function parseWorktreeList(output: string): Array<{ path: string; branch: string }> {
  const worktrees: Array<{ path: string; branch: string }> = [];
  const lines = output.trim().split('\n');

  let current: { path?: string; branch?: string } = {};

  for (const line of lines) {
    if (line === '') {
      if (current.path && current.branch) {
        worktrees.push({ path: current.path, branch: current.branch });
      }
      current = {};
      continue;
    }

    const [key, ...valueParts] = line.split(' ');
    const value = valueParts.join(' ');

    if (key === 'worktree') {
      current.path = value;
    } else if (key === 'branch') {
      current.branch = value.replace(/^refs\/heads\//, '');
    }
  }

  // Handle last worktree
  if (current.path && current.branch) {
    worktrees.push({ path: current.path, branch: current.branch });
  }

  return worktrees;
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

  // Get current git branch
  let gitBranch: string | undefined;
  try {
    const { stdout: branch } = await execAsync('git branch --show-current', {
      cwd: repoPath,
    });
    gitBranch = branch.trim();
  } catch {
    // Failed to get branch - repository might not have any commits yet
    logger.debug(`Failed to get git branch for ${repoPath}`);
  }

  return {
    id: `${folderName}-${stats.ino}`,
    path: repoPath,
    folderName,
    lastModified,
    relativePath,
    gitBranch,
  };
}
