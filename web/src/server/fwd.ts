#!/usr/bin/env pnpm exec tsx --no-deprecation

/**
 * VibeTunnel Forward (fwd.ts)
 *
 * A simple command-line tool that spawns a PTY session and forwards it
 * using the VibeTunnel PTY infrastructure.
 *
 * Usage:
 *   pnpm exec tsx src/fwd.ts <command> [args...]
 *   pnpm exec tsx src/fwd.ts claude --resume
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { type SessionInfo, TitleMode } from '../shared/types.js';
import { PtyManager } from './pty/index.js';
import { SessionManager } from './pty/session-manager.js';
import { VibeTunnelSocketClient } from './pty/socket-client.js';
import { ActivityDetector } from './utils/activity-detector.js';
import { checkAndPatchClaude } from './utils/claude-patcher.js';
import { detectGitInfo } from './utils/git-info.js';
import {
  closeLogger,
  createLogger,
  parseVerbosityLevel,
  setLogFilePath,
  setVerbosityLevel,
  VerbosityLevel,
} from './utils/logger.js';
import { generateSessionName } from './utils/session-naming.js';
import { generateTitleSequence } from './utils/terminal-title.js';
import { parseVerbosityFromEnv } from './utils/verbosity-parser.js';
import { BUILD_DATE, GIT_COMMIT, VERSION } from './version.js';

const logger = createLogger('fwd');
const _execFile = promisify(require('child_process').execFile);

function showUsage() {
  console.log(chalk.blue(`VibeTunnel Forward v${VERSION}`) + chalk.gray(` (${BUILD_DATE})`));
  console.log('');
  console.log('Usage:');
  console.log(
    '  pnpm exec tsx src/fwd.ts [--session-id <id>] [--title-mode <mode>] [--verbosity <level>] <command> [args...]'
  );
  console.log('');
  console.log('Options:');
  console.log('  --session-id <id>     Use a pre-generated session ID');
  console.log('  --title-mode <mode>   Terminal title mode: none, filter, static, dynamic');
  console.log('                        (defaults to none for most commands, dynamic for claude)');
  console.log('  --update-title <title> Update session title and exit (requires --session-id)');
  console.log(
    '  --verbosity <level>   Set logging verbosity: silent, error, warn, info, verbose, debug'
  );
  console.log('                        (defaults to error)');
  console.log('  --log-file <path>     Override default log file location');
  console.log('                        (defaults to ~/.vibetunnel/log.txt)');
  console.log('');
  console.log('Title Modes:');
  console.log('  none     - No title management (default)');
  console.log('  filter   - Block all title changes from applications');
  console.log('  static   - Show working directory and command');
  console.log('  dynamic  - Show directory, command, and activity (auto-selected for claude)');
  console.log('');
  console.log('Verbosity Levels:');
  console.log(`  ${chalk.gray('silent')}   - No output except critical errors`);
  console.log(`  ${chalk.red('error')}    - Only errors ${chalk.gray('(default)')}`);
  console.log(`  ${chalk.yellow('warn')}     - Errors and warnings`);
  console.log(`  ${chalk.green('info')}     - Errors, warnings, and informational messages`);
  console.log(`  ${chalk.blue('verbose')}  - All messages except debug`);
  console.log(`  ${chalk.magenta('debug')}    - All messages including debug`);
  console.log('');
  console.log(
    `Quick verbosity: ${chalk.cyan('-q (quiet), -v (verbose), -vv (extra), -vvv (debug)')}`
  );
  console.log('');
  console.log('Environment Variables:');
  console.log('  VIBETUNNEL_TITLE_MODE=<mode>         Set default title mode');
  console.log('  VIBETUNNEL_CLAUDE_DYNAMIC_TITLE=1    Force dynamic title for Claude');
  console.log('  VIBETUNNEL_LOG_LEVEL=<level>         Set default verbosity level');
  console.log('  VIBETUNNEL_DEBUG=1                   Enable debug mode (legacy)');
  console.log('');
  console.log('Examples:');
  console.log('  pnpm exec tsx src/fwd.ts claude --resume');
  console.log('  pnpm exec tsx src/fwd.ts --title-mode static bash -l');
  console.log('  pnpm exec tsx src/fwd.ts --title-mode filter vim');
  console.log('  pnpm exec tsx src/fwd.ts --session-id abc123 claude');
  console.log('  pnpm exec tsx src/fwd.ts --update-title "New Title" --session-id abc123');
  console.log('  pnpm exec tsx src/fwd.ts --verbosity silent npm test');
  console.log('');
  console.log('The command will be spawned in the current working directory');
  console.log('and managed through the VibeTunnel PTY infrastructure.');
}

export async function startVibeTunnelForward(args: string[]) {
  // Parse verbosity from environment variables
  let verbosityLevel = parseVerbosityFromEnv();

  // Set debug mode on logger for backward compatibility
  if (verbosityLevel === VerbosityLevel.DEBUG) {
    logger.setDebugMode(true);
  }

  // Parse command line arguments
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showUsage();
    closeLogger();
    process.exit(0);
  }

  logger.debug(chalk.blue(`VibeTunnel Forward v${VERSION}`) + chalk.gray(` (${BUILD_DATE})`));
  logger.debug(`Full command: ${args.join(' ')}`);

  // Parse command line arguments
  let sessionId: string | undefined;
  let titleMode: TitleMode = TitleMode.NONE;
  let updateTitle: string | undefined;
  let logFilePath: string | undefined;
  let remainingArgs = args;

  // Check environment variables for title mode
  if (process.env.VIBETUNNEL_TITLE_MODE) {
    const envMode = process.env.VIBETUNNEL_TITLE_MODE.toLowerCase();
    if (Object.values(TitleMode).includes(envMode as TitleMode)) {
      titleMode = envMode as TitleMode;
      logger.debug(`Title mode set from environment: ${titleMode}`);
    }
  }

  // Force dynamic mode for Claude via environment variable
  if (
    process.env.VIBETUNNEL_CLAUDE_DYNAMIC_TITLE === '1' ||
    process.env.VIBETUNNEL_CLAUDE_DYNAMIC_TITLE === 'true'
  ) {
    titleMode = TitleMode.DYNAMIC;
    logger.debug('Forced dynamic title mode for Claude via environment variable');
  }

  // Parse flags
  while (remainingArgs.length > 0) {
    if (remainingArgs[0] === '--session-id' && remainingArgs.length > 1) {
      sessionId = remainingArgs[1];
      remainingArgs = remainingArgs.slice(2);
    } else if (remainingArgs[0] === '--update-title' && remainingArgs.length > 1) {
      updateTitle = remainingArgs[1];
      remainingArgs = remainingArgs.slice(2);
    } else if (remainingArgs[0] === '--title-mode' && remainingArgs.length > 1) {
      const mode = remainingArgs[1].toLowerCase();
      if (Object.values(TitleMode).includes(mode as TitleMode)) {
        titleMode = mode as TitleMode;
      } else {
        logger.error(`Invalid title mode: ${remainingArgs[1]}`);
        logger.error(`Valid modes: ${Object.values(TitleMode).join(', ')}`);
        closeLogger();
        process.exit(1);
      }
      remainingArgs = remainingArgs.slice(2);
    } else if (remainingArgs[0] === '--verbosity' && remainingArgs.length > 1) {
      const parsedLevel = parseVerbosityLevel(remainingArgs[1]);
      if (parsedLevel !== undefined) {
        verbosityLevel = parsedLevel;
      } else {
        logger.error(`Invalid verbosity level: ${remainingArgs[1]}`);
        logger.error('Valid levels: silent, error, warn, info, verbose, debug');
        closeLogger();
        process.exit(1);
      }
      remainingArgs = remainingArgs.slice(2);
    } else if (remainingArgs[0] === '--log-file' && remainingArgs.length > 1) {
      logFilePath = remainingArgs[1];
      remainingArgs = remainingArgs.slice(2);
    } else {
      // Not a flag, must be the start of the command
      break;
    }
  }

  // Handle -- separator (used by some shells as end-of-options marker)
  // This allows commands like: fwd -- command-with-dashes
  if (remainingArgs[0] === '--' && remainingArgs.length > 1) {
    remainingArgs = remainingArgs.slice(1);
  }

  // Apply log file path if set
  if (logFilePath !== undefined) {
    setLogFilePath(logFilePath);
    logger.debug(`Log file path set to: ${logFilePath}`);
  }

  // Apply verbosity level if set
  if (verbosityLevel !== undefined) {
    setVerbosityLevel(verbosityLevel);
    if (verbosityLevel >= VerbosityLevel.INFO) {
      logger.log(`Verbosity level set to: ${VerbosityLevel[verbosityLevel].toLowerCase()}`);
    }
  }

  // Handle special case: --update-title mode
  if (updateTitle !== undefined) {
    if (!sessionId) {
      logger.error('--update-title requires --session-id');
      closeLogger();
      process.exit(1);
    }

    // Initialize session manager
    const controlPath = path.join(os.homedir(), '.vibetunnel', 'control');
    const sessionManager = new SessionManager(controlPath);

    // Validate session ID format for security
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
      logger.error(
        `Invalid session ID format: "${sessionId}". Session IDs must only contain letters, numbers, hyphens (-), and underscores (_).`
      );
      closeLogger();
      process.exit(1);
    }

    try {
      // Load existing session info
      const sessionInfo = sessionManager.loadSessionInfo(sessionId);
      if (!sessionInfo) {
        logger.error(`Session ${sessionId} not found`);
        closeLogger();
        process.exit(1);
      }

      // Sanitize the title - limit length and filter out problematic characters
      const sanitizedTitle = updateTitle
        .substring(0, 256) // Limit length
        .split('')
        .filter((char) => {
          const code = char.charCodeAt(0);
          // Allow printable characters (space to ~) and extended ASCII/Unicode
          return code >= 32 && code !== 127 && (code < 128 || code > 159);
        })
        .join('');

      // Update the title via IPC if session is active
      const socketPath = path.join(controlPath, sessionId, 'ipc.sock');

      // Check if IPC socket exists (session is active)
      if (fs.existsSync(socketPath)) {
        logger.debug(`IPC socket found, sending title update via IPC`);

        // Connect to IPC socket and send update-title command
        const socketClient = new VibeTunnelSocketClient(socketPath, {
          autoReconnect: false, // One-shot operation
        });

        try {
          await socketClient.connect();

          // Send update-title command
          const sent = socketClient.updateTitle(sanitizedTitle);

          if (sent) {
            logger.log(`Session title updated to: ${sanitizedTitle}`);
            // IPC update succeeded, server will handle the file update
            socketClient.disconnect();
            closeLogger();
            process.exit(0);
          } else {
            logger.warn(`Failed to send title update via IPC, falling back to file update`);
          }

          // Disconnect after sending
          socketClient.disconnect();
        } catch (ipcError) {
          logger.warn(`IPC connection failed: ${ipcError}, falling back to file update`);
        }
      } else {
        logger.debug(`No IPC socket found, session might not be active`);
      }

      // Only update the file if IPC failed or socket doesn't exist
      sessionInfo.name = sanitizedTitle;
      sessionManager.saveSessionInfo(sessionId, sessionInfo);

      logger.log(`Session title updated to: ${sanitizedTitle}`);
      closeLogger();
      process.exit(0);
    } catch (error) {
      logger.error(
        `Failed to update session title: ${error instanceof Error ? error.message : String(error)}`
      );
      closeLogger();
      process.exit(1);
    }
  }

  let command = remainingArgs;

  if (command.length === 0) {
    logger.error('No command specified');
    showUsage();
    closeLogger();
    process.exit(1);
  }

  // Check if this is Claude and patch it if necessary (only in debug mode)
  if (process.env.VIBETUNNEL_DEBUG === '1' || process.env.VIBETUNNEL_DEBUG === 'true') {
    const patchedCommand = checkAndPatchClaude(command);
    if (patchedCommand !== command) {
      command = patchedCommand;
      logger.debug(`Command updated after patching`);
    }
  }

  // Auto-select dynamic mode for Claude if no mode was explicitly set
  if (titleMode === TitleMode.NONE) {
    // Check all command arguments for Claude
    const isClaudeCommand = command.some((arg) => arg.toLowerCase().includes('claude'));
    if (isClaudeCommand) {
      titleMode = TitleMode.DYNAMIC;
      logger.log(chalk.cyan('✓ Auto-selected dynamic title mode for Claude'));
      logger.debug(`Detected Claude in command: ${command.join(' ')}`);
    }
  }

  const cwd = process.cwd();

  // Initialize PTY manager with fallback support
  const controlPath = path.join(os.homedir(), '.vibetunnel', 'control');
  logger.debug(`Control path: ${controlPath}`);

  // Initialize PtyManager before creating instance
  await PtyManager.initialize().catch((error) => {
    logger.error('Failed to initialize PTY manager:', error);
    closeLogger();
    process.exit(1);
  });

  const ptyManager = new PtyManager(controlPath);

  // Store original terminal dimensions
  // For external spawns, wait a moment for terminal to fully initialize
  const isExternalSpawn = process.env.VIBETUNNEL_SESSION_ID !== undefined;

  let originalCols: number | undefined;
  let originalRows: number | undefined;

  if (isExternalSpawn) {
    // Give terminal window time to fully initialize its dimensions
    await new Promise((resolve) => setTimeout(resolve, 100));

    // For external spawns, try to get the actual terminal size
    // If stdout isn't properly connected, don't use fallback values
    if (process.stdout.isTTY && process.stdout.columns && process.stdout.rows) {
      originalCols = process.stdout.columns;
      originalRows = process.stdout.rows;
      logger.debug(`External spawn using actual terminal size: ${originalCols}x${originalRows}`);
    } else {
      // Don't pass dimensions - let PTY use terminal's natural size
      logger.debug('External spawn: terminal dimensions not available, using terminal defaults');
    }
  } else {
    // For non-external spawns, use reasonable defaults
    originalCols = process.stdout.columns || 120;
    originalRows = process.stdout.rows || 40;
    logger.debug(`Regular spawn with dimensions: ${originalCols}x${originalRows}`);
  }

  try {
    // Create a human-readable session name
    const sessionName = generateSessionName(command, cwd);

    // Pre-generate session ID if not provided
    const finalSessionId = sessionId || `fwd_${Date.now()}`;

    logger.log(`Creating session for command: ${command.join(' ')}`);
    logger.debug(`Session ID: ${finalSessionId}, working directory: ${cwd}`);

    // Log title mode if not default
    if (titleMode !== TitleMode.NONE) {
      const modeDescriptions = {
        [TitleMode.FILTER]: 'Terminal title changes will be blocked',
        [TitleMode.STATIC]: 'Terminal title will show path and command',
        [TitleMode.DYNAMIC]: 'Terminal title will show path, command, and activity',
      };
      logger.log(chalk.cyan(`✓ ${modeDescriptions[titleMode]}`));
    }

    // Detect Git information
    const gitInfo = await detectGitInfo(cwd);

    // Variables that need to be accessible in cleanup
    let sessionFileWatcher: fs.FSWatcher | undefined;
    let fileWatchDebounceTimer: NodeJS.Timeout | undefined;

    const sessionOptions: Parameters<typeof ptyManager.createSession>[1] = {
      sessionId: finalSessionId,
      name: sessionName,
      workingDir: cwd,
      titleMode: titleMode,
      forwardToStdout: true,
      gitRepoPath: gitInfo.gitRepoPath,
      gitBranch: gitInfo.gitBranch,
      gitAheadCount: gitInfo.gitAheadCount,
      gitBehindCount: gitInfo.gitBehindCount,
      gitHasChanges: gitInfo.gitHasChanges,
      gitIsWorktree: gitInfo.gitIsWorktree,
      gitMainRepoPath: gitInfo.gitMainRepoPath,
      onExit: async (exitCode: number) => {
        // Show exit message
        logger.log(
          chalk.yellow(`\n✓ VibeTunnel session ended`) + chalk.gray(` (exit code: ${exitCode})`)
        );

        // Remove resize listener
        process.stdout.removeListener('resize', resizeHandler);

        // Restore terminal settings and clean up stdin
        if (process.stdin.isTTY) {
          logger.debug('Restoring terminal to normal mode');
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();
        process.stdin.removeAllListeners();

        // Destroy stdin to ensure it doesn't keep the process alive
        if (process.stdin.destroy) {
          process.stdin.destroy();
        }

        // Restore original stdout.write if we hooked it
        if (cleanupStdout) {
          cleanupStdout();
        }

        // Clean up file watchers
        if (sessionFileWatcher) {
          sessionFileWatcher.close();
          sessionFileWatcher = undefined;
          logger.debug('Closed session file watcher');
        }
        if (fileWatchDebounceTimer) {
          clearTimeout(fileWatchDebounceTimer);
        }
        // Stop watching the file
        fs.unwatchFile(sessionJsonPath);

        // Clean up only this session, not all sessions
        logger.debug(`Cleaning up session ${finalSessionId}`);
        try {
          await ptyManager.killSession(finalSessionId);
        } catch (error) {
          // Session might already be cleaned up
          logger.debug(`Session ${finalSessionId} cleanup error (likely already cleaned):`, error);
        }

        // Force exit
        closeLogger();
        process.exit(exitCode || 0);
      },
    };

    // Only add dimensions if they're available (for non-external spawns or when TTY is properly connected)
    if (originalCols !== undefined && originalRows !== undefined) {
      sessionOptions.cols = originalCols;
      sessionOptions.rows = originalRows;
    }

    const result = await ptyManager.createSession(command, sessionOptions);

    // Get session info
    const session = ptyManager.getSession(result.sessionId);
    if (!session) {
      throw new Error('Session not found after creation');
    }
    // Log session info with version
    logger.log(chalk.green(`✓ VibeTunnel session started`) + chalk.gray(` (v${VERSION})`));
    logger.log(chalk.gray('Command:'), command.join(' '));
    logger.log(chalk.gray('Control directory:'), path.join(controlPath, result.sessionId));
    logger.log(chalk.gray('Build:'), `${BUILD_DATE} | Commit: ${GIT_COMMIT}`);

    // Connect to the session's IPC socket
    const socketPath = path.join(controlPath, result.sessionId, 'ipc.sock');
    const socketClient = new VibeTunnelSocketClient(socketPath, {
      autoReconnect: true,
      heartbeatInterval: 30000, // 30 seconds
    });

    // Wait for socket connection
    try {
      await socketClient.connect();
      logger.debug('Connected to session IPC socket');
    } catch (error) {
      logger.error('Failed to connect to session socket:', error);
      throw error;
    }

    // Set up terminal resize handler
    const resizeHandler = () => {
      const cols = process.stdout.columns || 80;
      const rows = process.stdout.rows || 24;
      logger.debug(`Terminal resized to ${cols}x${rows}`);

      // Send resize command through socket
      if (!socketClient.resize(cols, rows)) {
        logger.error('Failed to send resize command');
      }
    };

    // Listen for terminal resize events
    process.stdout.on('resize', resizeHandler);

    // Set up file watcher for session.json changes (for external updates)
    const sessionJsonPath = path.join(controlPath, result.sessionId, 'session.json');
    let lastKnownSessionName = result.sessionInfo.name;

    // Set up file watcher with retry logic
    const setupFileWatcher = async (retryCount = 0) => {
      const maxRetries = 5;
      const retryDelay = 500 * 2 ** retryCount; // Exponential backoff

      try {
        // Check if file exists
        if (!fs.existsSync(sessionJsonPath)) {
          if (retryCount < maxRetries) {
            logger.debug(
              `Session file not found, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries})`
            );
            setTimeout(() => setupFileWatcher(retryCount + 1), retryDelay);
            return;
          } else {
            logger.warn(`Session file not found after ${maxRetries} attempts: ${sessionJsonPath}`);
            return;
          }
        }

        logger.log(`Setting up file watcher for session name changes`);

        // Function to check and update title if session name changed
        const checkSessionNameChange = () => {
          try {
            // Check file still exists before reading
            if (!fs.existsSync(sessionJsonPath)) {
              return;
            }

            const sessionContent = fs.readFileSync(sessionJsonPath, 'utf-8');
            const updatedInfo = JSON.parse(sessionContent) as SessionInfo;

            // Check if session name changed
            if (updatedInfo.name !== lastKnownSessionName) {
              logger.debug(
                `[File Watch] Session name changed from "${lastKnownSessionName}" to "${updatedInfo.name}"`
              );
              lastKnownSessionName = updatedInfo.name;

              // Always update terminal title when session name changes
              // Generate new title sequence based on title mode
              let titleSequence: string;
              if (titleMode === TitleMode.NONE || titleMode === TitleMode.FILTER) {
                // For NONE and FILTER modes, just use the session name
                titleSequence = `\x1B]2;${updatedInfo.name}\x07`;
              } else {
                // For STATIC and DYNAMIC, use the full format with path and command
                titleSequence = generateTitleSequence(cwd, command, updatedInfo.name);
              }

              // Write title sequence to terminal
              process.stdout.write(titleSequence);
              logger.log(`Updated terminal title to "${updatedInfo.name}" via file watcher`);
            }
          } catch (error) {
            logger.error('Failed to check session.json:', error);
          }
        };

        // Use fs.watchFile for more reliable file monitoring (polling-based)
        fs.watchFile(sessionJsonPath, { interval: 500 }, (curr, prev) => {
          logger.debug(`[File Watch] File stats changed - mtime: ${curr.mtime} vs ${prev.mtime}`);
          if (curr.mtime !== prev.mtime) {
            checkSessionNameChange();
          }
        });

        // Also use fs.watch as a fallback for immediate notifications
        try {
          const sessionDir = path.dirname(sessionJsonPath);
          sessionFileWatcher = fs.watch(sessionDir, (eventType, filename) => {
            // Only log in debug mode to avoid noise
            logger.debug(`[File Watch] Directory event: ${eventType} on ${filename || 'unknown'}`);

            // Check if it's our file
            // On macOS, filename might be undefined, so we can't filter properly
            // In that case, skip fs.watch events and rely on fs.watchFile instead
            if (filename && (filename === 'session.json' || filename === 'session.json.tmp')) {
              // Debounce rapid changes
              if (fileWatchDebounceTimer) {
                clearTimeout(fileWatchDebounceTimer);
              }
              fileWatchDebounceTimer = setTimeout(checkSessionNameChange, 100);
            }
          });
        } catch (error) {
          logger.warn('Failed to set up fs.watch, relying on fs.watchFile:', error);
        }

        logger.log(`File watcher successfully set up with polling fallback`);

        // Clean up watcher on error if it was created
        sessionFileWatcher?.on('error', (error) => {
          logger.error('File watcher error:', error);
          sessionFileWatcher?.close();
          sessionFileWatcher = undefined;
        });
      } catch (error) {
        logger.error('Failed to set up file watcher:', error);
        if (retryCount < maxRetries) {
          setTimeout(() => setupFileWatcher(retryCount + 1), retryDelay);
        }
      }
    };

    // Start setting up the file watcher after a short delay
    setTimeout(() => setupFileWatcher(), 500);

    // Set up activity detector for Claude status updates
    let activityDetector: ActivityDetector | undefined;
    let cleanupStdout: (() => void) | undefined;

    if (titleMode === TitleMode.DYNAMIC) {
      activityDetector = new ActivityDetector(command, sessionId);

      // Hook into stdout to detect Claude status
      const originalStdoutWrite = process.stdout.write.bind(process.stdout);

      let isProcessingActivity = false;

      // Create a proper override that handles all overloads
      const _stdoutWriteOverride = function (
        this: NodeJS.WriteStream,
        chunk: string | Uint8Array,
        encodingOrCallback?: BufferEncoding | ((err?: Error | null) => void),
        callback?: (err?: Error | null) => void
      ): boolean {
        // Handle the overload: write(chunk, callback)
        if (typeof encodingOrCallback === 'function') {
          callback = encodingOrCallback;
          encodingOrCallback = undefined;
        }

        if (isProcessingActivity) {
          if (callback) {
            return originalStdoutWrite.call(
              this,
              chunk,
              encodingOrCallback as BufferEncoding | undefined,
              callback
            );
          } else if (encodingOrCallback && typeof encodingOrCallback === 'string') {
            return originalStdoutWrite.call(this, chunk, encodingOrCallback);
          } else {
            return originalStdoutWrite.call(this, chunk);
          }
        }

        isProcessingActivity = true;
        try {
          // Process output through activity detector
          if (activityDetector && typeof chunk === 'string') {
            const { filteredData, activity } = activityDetector.processOutput(chunk);

            // Send status update if detected
            if (activity.specificStatus) {
              socketClient.sendStatus(activity.specificStatus.app, activity.specificStatus.status);
            }

            // Call original with correct arguments
            if (callback) {
              return originalStdoutWrite.call(
                this,
                filteredData,
                encodingOrCallback as BufferEncoding | undefined,
                callback
              );
            } else if (encodingOrCallback && typeof encodingOrCallback === 'string') {
              return originalStdoutWrite.call(this, filteredData, encodingOrCallback);
            } else {
              return originalStdoutWrite.call(this, filteredData);
            }
          }

          // Pass through as-is if not string or no detector
          if (callback) {
            return originalStdoutWrite.call(
              this,
              chunk,
              encodingOrCallback as BufferEncoding | undefined,
              callback
            );
          } else if (encodingOrCallback && typeof encodingOrCallback === 'string') {
            return originalStdoutWrite.call(this, chunk, encodingOrCallback);
          } else {
            return originalStdoutWrite.call(this, chunk);
          }
        } finally {
          isProcessingActivity = false;
        }
      };

      // Apply the override
      process.stdout.write = _stdoutWriteOverride as typeof process.stdout.write;

      // Store reference for cleanup
      cleanupStdout = () => {
        process.stdout.write = originalStdoutWrite;
      };

      // Ensure cleanup happens on process exit
      process.on('exit', cleanupStdout);
      process.on('SIGINT', cleanupStdout);
      process.on('SIGTERM', cleanupStdout);
    }

    // Set up raw mode for terminal input
    if (process.stdin.isTTY) {
      logger.debug('Setting terminal to raw mode for input forwarding');
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    // Forward stdin through socket
    process.stdin.on('data', (data: string) => {
      // Send through socket
      if (!socketClient.sendStdin(data)) {
        logger.error('Failed to send stdin data');
      }
    });

    // Handle socket events
    socketClient.on('disconnect', (error) => {
      logger.error('Socket disconnected:', error?.message || 'Unknown error');
      process.exit(1);
    });

    socketClient.on('error', (error) => {
      logger.error('Socket error:', error);
    });

    // The process will stay alive because stdin is in raw mode and resumed
  } catch (error) {
    logger.error('Failed to create or manage session:', error);

    closeLogger();
    process.exit(1);
  }
}
