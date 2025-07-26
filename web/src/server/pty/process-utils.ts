/**
 * ProcessUtils - Cross-platform process management utilities
 *
 * Provides reliable process existence checking across Windows, macOS, and Linux.
 */

import chalk from 'chalk';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('process-utils');

/**
 * Get the appropriate shell configuration file for a given shell
 * @param shellPath The path to the shell executable
 * @returns The path to the shell config file, or null if none found
 */
function getShellConfigFile(shellPath: string): string | null {
  const homeDir = os.homedir();
  const shellName = path.basename(shellPath);

  // Map of shell names to their config files (in order of preference)
  const shellConfigs: Record<string, string[]> = {
    zsh: ['.zshrc', '.zshenv'],
    bash: ['.bashrc', '.bash_profile', '.profile'],
    sh: ['.profile'],
    ksh: ['.kshrc', '.profile'],
    fish: ['.config/fish/config.fish'],
    tcsh: ['.tcshrc', '.cshrc'],
    csh: ['.cshrc'],
    dash: ['.profile'],
  };

  // Get config files for this shell
  const configFiles = shellConfigs[shellName] || [];

  // Check each config file in order of preference
  for (const configFile of configFiles) {
    const fullPath = path.join(homeDir, configFile);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }

  // Fallback to .profile for unknown shells
  const profilePath = path.join(homeDir, '.profile');
  if (existsSync(profilePath)) {
    return profilePath;
  }

  return null;
}

/**
 * Safe file existence check
 */
function existsSync(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a process is currently running by PID
 * Uses platform-appropriate methods for reliable detection
 */
export function isProcessRunning(pid: number): boolean {
  if (!pid || pid <= 0) {
    return false;
  }

  try {
    if (process.platform === 'win32') {
      // Windows: Use tasklist command
      return isProcessRunningWindows(pid);
    } else {
      // Unix/Linux/macOS: Use kill with signal 0
      return isProcessRunningUnix(pid);
    }
  } catch (error) {
    logger.warn(`error checking if process ${pid} is running:`, error);
    return false;
  }
}

/**
 * Windows-specific process check using tasklist
 */
function isProcessRunningWindows(pid: number): boolean {
  try {
    logger.debug(`checking windows process ${pid} with tasklist`);
    const result = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000, // 5 second timeout
    });

    // Check if the command succeeded and PID appears in output
    if (result.status === 0 && result.stdout) {
      // tasklist outputs CSV format with PID in quotes
      const exists = result.stdout.includes(`"${pid}"`);
      logger.debug(`process ${pid} exists: ${exists}`);
      return exists;
    }

    logger.debug(`tasklist command failed with status ${result.status}`);
    return false;
  } catch (error) {
    logger.warn(`windows process check failed for PID ${pid}:`, error);
    return false;
  }
}

/**
 * Unix-like systems process check using kill signal 0
 */
function isProcessRunningUnix(pid: number): boolean {
  try {
    // Send signal 0 to check if process exists
    // This doesn't actually kill the process, just checks existence
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // If we get ESRCH, the process doesn't exist
    // If we get EPERM, the process exists but we don't have permission
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'EPERM') {
      // Process exists but we don't have permission to signal it
      return true;
    }
    // ESRCH or other errors mean process doesn't exist
    return false;
  }
}

/**
 * Get basic process information if available
 * Returns null if process is not running or info cannot be retrieved
 */
export function getProcessInfo(pid: number): { pid: number; exists: boolean } | null {
  if (!isProcessRunning(pid)) {
    return null;
  }

  return {
    pid,
    exists: true,
  };
}

/**
 * Kill a process with platform-appropriate method
 * Returns true if the kill signal was sent successfully
 */
export function killProcess(pid: number, signal: NodeJS.Signals | number = 'SIGTERM'): boolean {
  if (!pid || pid <= 0) {
    return false;
  }

  logger.debug(`attempting to kill process ${pid} with signal ${signal}`);

  try {
    if (process.platform === 'win32') {
      // Windows: Use taskkill command for more reliable termination
      const result = spawnSync('taskkill', ['/PID', pid.toString(), '/F'], {
        windowsHide: true,
        timeout: 5000,
      });
      if (result.status === 0) {
        logger.log(chalk.green(`process ${pid} killed successfully`));
        return true;
      } else {
        logger.debug(`taskkill failed with status ${result.status}`);
        return false;
      }
    } else {
      // Unix-like: Use built-in process.kill
      process.kill(pid, signal);
      logger.log(chalk.green(`signal ${signal} sent to process ${pid}`));
      return true;
    }
  } catch (error) {
    logger.warn(`error killing process ${pid}:`, error);
    return false;
  }
}

/**
 * Wait for a process to exit with timeout
 * Returns true if process exited within timeout, false otherwise
 */
export async function waitForProcessExit(pid: number, timeoutMs: number = 5000): Promise<boolean> {
  const startTime = Date.now();
  const checkInterval = 100; // Check every 100ms

  logger.debug(`waiting for process ${pid} to exit (timeout: ${timeoutMs}ms)`);

  while (Date.now() - startTime < timeoutMs) {
    if (!isProcessRunning(pid)) {
      const elapsed = Date.now() - startTime;
      logger.log(chalk.green(`process ${pid} exited after ${elapsed}ms`));
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, checkInterval));
  }

  logger.log(chalk.yellow(`process ${pid} did not exit within ${timeoutMs}ms timeout`));
  return false;
}

/**
 * Check if this is an interactive shell session
 */
function isInteractiveShellCommand(cmdName: string, args: string[]): boolean {
  // Common shells
  const shells = ['bash', 'zsh', 'sh', 'fish', 'dash', 'ksh', 'tcsh', 'csh'];
  const isShell = shells.some((shell) => cmdName === shell || cmdName.endsWith(`/${shell}`));

  if (!isShell) return false;

  // Check for interactive flags
  const interactiveFlags = ['-i', '--interactive', '-l', '--login'];

  // If no args, it's interactive by default
  if (args.length === 0) return true;

  // Check if any args indicate interactive mode
  return args.some((arg) => interactiveFlags.includes(arg));
}

/**
 * Determine how to spawn a command, checking if it exists in PATH or needs shell execution
 * Returns the actual command and args to use for spawning
 */
export function resolveCommand(command: string[]): {
  command: string;
  args: string[];
  useShell: boolean;
  isInteractive?: boolean;
  resolvedFrom?: 'path' | 'alias' | 'builtin' | 'shell';
  originalCommand?: string;
} {
  if (command.length === 0) {
    throw new Error('No command provided');
  }

  const cmdName = command[0];
  const cmdArgs = command.slice(1);

  // Check if command exists in PATH using 'which' (Unix) or 'where' (Windows)
  const whichCommand = process.platform === 'win32' ? 'where' : 'which';

  try {
    const result = spawnSync(whichCommand, [cmdName], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 2000, // 2 second timeout
    });

    if (result.status === 0 && result.stdout && result.stdout.trim()) {
      // Command found in PATH
      logger.debug(`Command '${cmdName}' found at: ${result.stdout.trim()}`);

      // Check if this is an interactive shell command
      if (isInteractiveShellCommand(cmdName, cmdArgs)) {
        logger.log(chalk.cyan(`✓ Starting ${cmdName} as login shell to load configuration files`));
        // Add both -i (interactive) and -l/--login flags for proper shell initialization
        // This ensures shell RC files are sourced and the environment is properly set up

        // Don't add flags if they're already present
        const hasInteractiveFlag = cmdArgs.some((arg) => arg === '-i' || arg === '--interactive');
        const hasLoginFlag = cmdArgs.some((arg) => arg === '-l' || arg === '--login');

        // Build args array
        const finalArgs = [...cmdArgs];

        // For fish shell, use --login and --interactive instead of -l and -i
        const isFish = cmdName === 'fish' || cmdName.endsWith('/fish');

        if (!hasInteractiveFlag) {
          finalArgs.unshift(isFish ? '--interactive' : '-i');
        }

        if (!hasLoginFlag) {
          finalArgs.unshift(isFish ? '--login' : '-l');
        }

        return {
          command: cmdName,
          args: finalArgs,
          useShell: false,
          resolvedFrom: 'path',
          originalCommand: cmdName,
          isInteractive: true,
        };
      }

      return {
        command: cmdName,
        args: cmdArgs,
        useShell: false,
        resolvedFrom: 'path',
        originalCommand: cmdName,
      };
    }
  } catch (error) {
    logger.debug(`Failed to check command existence for '${cmdName}':`, error);
  }

  // Command not found in PATH, likely an alias or shell builtin
  // Need to run through shell
  logger.debug(`Command '${cmdName}' not found in PATH, will use shell`);

  // Determine user's shell
  const userShell = getUserShell();

  // Check if this is trying to execute a command (not an interactive shell session)
  // If so, use non-interactive mode to ensure shell exits after execution
  const isCommand = !isInteractiveShellCommand(cmdName, cmdArgs);

  // Use interactive shell to execute the command
  // This ensures aliases and shell functions are available
  if (process.platform === 'win32') {
    // Windows shells have different syntax
    if (userShell.includes('bash')) {
      // Git Bash on Windows: Use Unix-style syntax
      if (isCommand) {
        // Non-interactive command execution
        return {
          command: userShell,
          args: ['-c', command.join(' ')],
          useShell: true,
          resolvedFrom: 'shell',
        };
      } else {
        // Interactive shell session
        return {
          command: userShell,
          args: ['-i', '-c', command.join(' ')],
          useShell: true,
          resolvedFrom: 'shell',
          isInteractive: true,
        };
      }
    } else if (userShell.includes('pwsh') || userShell.includes('powershell')) {
      // PowerShell: Use -Command for execution
      // Note: PowerShell aliases work differently than Unix aliases
      return {
        command: userShell,
        args: ['-NoLogo', '-Command', command.join(' ')],
        useShell: true,
        resolvedFrom: 'shell',
      };
    } else {
      // cmd.exe: Use /C to execute and exit
      // Note: cmd.exe uses 'doskey' for aliases, not traditional aliases
      return {
        command: userShell,
        args: ['/C', command.join(' ')],
        useShell: true,
        resolvedFrom: 'shell',
      };
    }
  } else {
    // Unix shells: Choose execution mode based on command type
    if (isCommand) {
      // Non-interactive command execution: shell will exit after completion
      // Use interactive mode to ensure aliases and functions are properly expanded
      const shellConfig = getShellConfigFile(userShell);

      if (shellConfig) {
        // Use interactive mode with login shell to ensure aliases are loaded and expanded
        // The -i flag enables interactive mode, which loads aliases
        // The -l flag makes it a login shell, ensuring profile/rc files are sourced
        return {
          command: userShell,
          args: ['-i', '-l', '-c', command.join(' ')],
          useShell: true,
          resolvedFrom: 'alias',
        };
      } else {
        // No shell config found, use basic execution
        return {
          command: userShell,
          args: ['-c', command.join(' ')],
          useShell: true,
          resolvedFrom: 'shell',
        };
      }
    } else {
      // Interactive shell session: use -i and -l for proper initialization
      return {
        command: userShell,
        args: ['-i', '-l', '-c', command.join(' ')],
        useShell: true,
        resolvedFrom: 'shell',
        isInteractive: true,
      };
    }
  }
}

/**
 * Get the user's preferred shell
 * Falls back to sensible defaults if SHELL env var is not set
 */
export function getUserShell(): string {
  // First try SHELL environment variable (most reliable on Unix)
  if (process.env.SHELL) {
    return process.env.SHELL;
  }

  // Platform-specific defaults
  if (process.platform === 'win32') {
    // Check for modern shells first

    // 1. Check for PowerShell Core (pwsh) - cross-platform version
    try {
      const result = spawnSync('pwsh', ['-Command', 'echo test'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 1000,
      });
      if (result.status === 0) {
        return 'pwsh';
      }
    } catch (_) {
      // PowerShell Core not available
    }

    // 2. Check for Windows PowerShell (older, Windows-only)
    const powershellPath = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    );
    try {
      const result = spawnSync(powershellPath, ['-Command', 'echo test'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 1000,
      });
      if (result.status === 0) {
        return powershellPath;
      }
    } catch (_) {
      // PowerShell not available
    }

    // 3. Check for Git Bash if available
    const gitBashPaths = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    ];
    for (const gitBashPath of gitBashPaths) {
      try {
        const result = spawnSync(gitBashPath, ['-c', 'echo test'], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 1000,
        });
        if (result.status === 0) {
          return gitBashPath;
        }
      } catch (_) {
        // Git Bash not at this location
      }
    }

    // 4. Fall back to cmd.exe
    return process.env.ComSpec || 'cmd.exe';
  } else {
    // Unix-like systems
    // Node.js os.userInfo() includes shell on some platforms
    try {
      const userInfo = os.userInfo();
      if ('shell' in userInfo && userInfo.shell) {
        return userInfo.shell as string;
      }
    } catch (_) {
      // userInfo might fail in some environments
    }

    // Check common shell paths in order of preference
    // Prefer bash over zsh to avoid first-run configuration issues in CI
    const commonShells = ['/bin/bash', '/usr/bin/bash', '/bin/zsh', '/usr/bin/zsh', '/bin/sh'];
    for (const shell of commonShells) {
      try {
        // Just check if the shell exists and is executable
        const result = spawnSync('test', ['-x', shell], {
          encoding: 'utf8',
          timeout: 500,
        });
        if (result.status === 0) {
          return shell;
        }
      } catch (_) {
        // test command failed, try next shell
      }
    }

    // Final fallback - /bin/sh should always exist on Unix
    return '/bin/sh';
  }
}

// Re-export as object for backwards compatibility
export const ProcessUtils = {
  isProcessRunning,
  getProcessInfo,
  killProcess,
  waitForProcessExit,
  resolveCommand,
  getUserShell,
};
