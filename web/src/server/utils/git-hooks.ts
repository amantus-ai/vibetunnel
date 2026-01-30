import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';
import { createGitError } from './git-error.js';
import { createLogger } from './logger.js';

const logger = createLogger('git-hooks');
const execFile = promisify(require('child_process').execFile);

interface HookInstallResult {
  success: boolean;
  error?: string;
  backedUp?: boolean;
}

interface HookUninstallResult {
  success: boolean;
  error?: string;
  restored?: boolean;
}

/**
 * Execute a git command with proper error handling
 */
async function execGit(
  args: string[],
  options: { cwd?: string } = {}
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFile('git', args, {
      cwd: options.cwd || process.cwd(),
      timeout: 5000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return { stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (error) {
    throw createGitError(error, 'Git command failed');
  }
}

/**
 * Get the Git hooks directory for a repository
 */
async function getHooksDirectory(repoPath: string): Promise<string> {
  try {
    // Check if core.hooksPath is configured
    const { stdout } = await execGit(['config', 'core.hooksPath'], { cwd: repoPath });
    const customPath = stdout.trim();
    if (customPath) {
      // Resolve relative to repo root
      return path.resolve(repoPath, customPath);
    }
  } catch {
    // core.hooksPath not set, use default
  }

  // Default hooks directory
  return path.join(repoPath, '.git', 'hooks');
}

/**
 * Create the hook script content
 */
function createHookScript(hookType: 'post-commit' | 'post-checkout'): string {
  return `#!/bin/sh
# VibeTunnel Git hook - ${hookType}
# This hook notifies VibeTunnel when Git events occur

# Check if vt command is available
if command -v vt >/dev/null 2>&1; then
  # Run in background to avoid blocking Git operations
  vt git event &
fi

# Always exit successfully
exit 0
`;
}

/**
 * Install a Git hook with safe chaining
 */
async function installHook(
  repoPath: string,
  hookType: 'post-commit' | 'post-checkout'
): Promise<HookInstallResult> {
  try {
    const hooksDir = await getHooksDirectory(repoPath);
    const hookPath = path.join(hooksDir, hookType);
    const backupPath = `${hookPath}.vtbak`;

    // Ensure hooks directory exists
    await fs.mkdir(hooksDir, { recursive: true });

    // Check if hook already exists
    let existingHook: string | null = null;
    try {
      existingHook = await fs.readFile(hookPath, 'utf8');
    } catch {
      // Hook doesn't exist yet
    }

    // If hook exists and is already ours, skip
    if (existingHook?.includes('VibeTunnel Git hook')) {
      logger.debug(`${hookType} hook already installed`);
      return { success: true };
    }

    // If hook exists and is not ours, back it up
    if (existingHook) {
      await fs.writeFile(backupPath, existingHook);
      logger.debug(`Backed up existing ${hookType} hook to ${backupPath}`);
    }

    // Create our hook script
    let hookContent = createHookScript(hookType);

    // If there was an existing hook, chain it
    if (existingHook) {
      hookContent = `#!/bin/sh
# VibeTunnel Git hook - ${hookType}
# This hook notifies VibeTunnel when Git events occur

# Check if vt command is available
if command -v vt >/dev/null 2>&1; then
  # Run in background to avoid blocking Git operations
  vt git event &
fi

# Execute the original hook if it exists
if [ -f "${backupPath}" ]; then
  exec "${backupPath}" "$@"
fi

exit 0
`;
    }

    // Write the hook
    await fs.writeFile(hookPath, hookContent);

    // Make it executable
    await fs.chmod(hookPath, 0o755);

    logger.info(`Successfully installed ${hookType} hook`);
    return { success: true, backedUp: !!existingHook };
  } catch (error) {
    logger.error(`Failed to install ${hookType} hook:`, error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Uninstall a Git hook and restore backup
 */
async function uninstallHook(
  repoPath: string,
  hookType: 'post-commit' | 'post-checkout'
): Promise<HookUninstallResult> {
  try {
    const hooksDir = await getHooksDirectory(repoPath);
    const hookPath = path.join(hooksDir, hookType);
    const backupPath = `${hookPath}.vtbak`;

    // Check if hook exists
    let existingHook: string | null = null;
    try {
      existingHook = await fs.readFile(hookPath, 'utf8');
    } catch {
      // Hook doesn't exist
      return { success: true };
    }

    // If it's not our hook, leave it alone
    if (!existingHook.includes('VibeTunnel Git hook')) {
      logger.debug(`${hookType} hook is not ours, skipping uninstall`);
      return { success: true };
    }

    // Check if there's a backup to restore
    let hasBackup = false;
    try {
      await fs.access(backupPath);
      hasBackup = true;
    } catch {
      // No backup
    }

    if (hasBackup) {
      // Restore the backup
      const backupContent = await fs.readFile(backupPath, 'utf8');
      await fs.writeFile(hookPath, backupContent);
      await fs.chmod(hookPath, 0o755);
      await fs.unlink(backupPath);
      logger.info(`Restored original ${hookType} hook from backup`);
      return { success: true, restored: true };
    } else {
      // No backup, just remove our hook
      await fs.unlink(hookPath);
      logger.info(`Removed ${hookType} hook`);
      return { success: true, restored: false };
    }
  } catch (error) {
    logger.error(`Failed to uninstall ${hookType} hook:`, error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Install Git hooks for VibeTunnel follow mode
 */
export async function installGitHooks(repoPath: string): Promise<{
  success: boolean;
  errors?: string[];
}> {
  logger.info(`Installing Git hooks for repository: ${repoPath}`);

  const results = await Promise.all([
    installHook(repoPath, 'post-commit'),
    installHook(repoPath, 'post-checkout'),
  ]);

  const errors = results
    .filter((r) => !r.success)
    .map((r) => r.error)
    .filter((e): e is string => !!e);

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return { success: true };
}

/**
 * Uninstall Git hooks for VibeTunnel follow mode
 */
export async function uninstallGitHooks(repoPath: string): Promise<{
  success: boolean;
  errors?: string[];
}> {
  logger.info(`Uninstalling Git hooks for repository: ${repoPath}`);

  const results = await Promise.all([
    uninstallHook(repoPath, 'post-commit'),
    uninstallHook(repoPath, 'post-checkout'),
  ]);

  const errors = results
    .filter((r) => !r.success)
    .map((r) => r.error)
    .filter((e): e is string => !!e);

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return { success: true };
}

/**
 * Check if Git hooks are installed
 */
export async function areHooksInstalled(repoPath: string): Promise<boolean> {
  try {
    const hooksDir = await getHooksDirectory(repoPath);
    const hooks = ['post-commit', 'post-checkout'];

    for (const hookType of hooks) {
      const hookPath = path.join(hooksDir, hookType);
      try {
        const content = await fs.readFile(hookPath, 'utf8');
        if (!content.includes('VibeTunnel Git hook')) {
          return false;
        }
      } catch {
        return false;
      }
    }

    return true;
  } catch (error) {
    logger.error('Failed to check hook installation:', error);
    return false;
  }
}
