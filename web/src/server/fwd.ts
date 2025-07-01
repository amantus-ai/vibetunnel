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
import * as os from 'os';
import * as path from 'path';
import { TitleMode } from '../shared/types.js';
import { PtyManager } from './pty/index.js';
import { VibeTunnelSocketClient } from './pty/socket-client.js';
import { ActivityDetector } from './utils/activity-detector.js';
import { closeLogger, createLogger } from './utils/logger.js';
import { generateSessionName } from './utils/session-naming.js';
import { BUILD_DATE, GIT_COMMIT, VERSION } from './version.js';

const logger = createLogger('fwd');

function showUsage() {
  console.log(chalk.blue(`VibeTunnel Forward v${VERSION}`) + chalk.gray(` (${BUILD_DATE})`));
  console.log('');
  console.log('Usage:');
  console.log(
    '  pnpm exec tsx src/fwd.ts [--session-id <id>] [--title-mode <mode>] <command> [args...]'
  );
  console.log('');
  console.log('Options:');
  console.log('  --session-id <id>     Use a pre-generated session ID');
  console.log('  --title-mode <mode>   Terminal title mode: none, filter, static, dynamic');
  console.log('                        (defaults to none for most commands, dynamic for claude)');
  console.log('');
  console.log('Title Modes:');
  console.log('  none     - No title management (default)');
  console.log('  filter   - Block all title changes from applications');
  console.log('  static   - Show working directory and command');
  console.log('  dynamic  - Show directory, command, and activity (auto-selected for claude)');
  console.log('');
  console.log('Environment Variables:');
  console.log('  VIBETUNNEL_TITLE_MODE=<mode>         Set default title mode');
  console.log('  VIBETUNNEL_CLAUDE_DYNAMIC_TITLE=1    Force dynamic title for Claude');
  console.log('');
  console.log('Examples:');
  console.log('  pnpm exec tsx src/fwd.ts claude --resume');
  console.log('  pnpm exec tsx src/fwd.ts --title-mode static bash -l');
  console.log('  pnpm exec tsx src/fwd.ts --title-mode filter vim');
  console.log('  pnpm exec tsx src/fwd.ts --session-id abc123 claude');
  console.log('');
  console.log('The command will be spawned in the current working directory');
  console.log('and managed through the VibeTunnel PTY infrastructure.');
}

export async function startVibeTunnelForward(args: string[]) {
  // Log startup with version (logger already initialized in cli.ts)
  if (process.env.VIBETUNNEL_DEBUG === '1' || process.env.VIBETUNNEL_DEBUG === 'true') {
    logger.debug('Debug mode enabled');
  }

  // Parse command line arguments
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showUsage();
    closeLogger();
    process.exit(0);
  }

  logger.log(chalk.blue(`VibeTunnel Forward v${VERSION}`) + chalk.gray(` (${BUILD_DATE})`));
  logger.debug(`Full command: ${args.join(' ')}`);

  // Parse command line arguments
  let sessionId: string | undefined;
  let titleMode: TitleMode = TitleMode.NONE;
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

  const command = remainingArgs;

  if (command.length === 0) {
    logger.error('No command specified');
    showUsage();
    closeLogger();
    process.exit(1);
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

  // Initialize PTY manager
  const controlPath = path.join(os.homedir(), '.vibetunnel', 'control');
  logger.debug(`Control path: ${controlPath}`);
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

    const sessionOptions: Parameters<typeof ptyManager.createSession>[1] = {
      sessionId: finalSessionId,
      name: sessionName,
      workingDir: cwd,
      titleMode: titleMode,
      forwardToStdout: true,
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

        // Shutdown PTY manager and exit
        logger.debug('Shutting down PTY manager');
        await ptyManager.shutdown();

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

    // Set up activity detector for Claude status updates
    let activityDetector: ActivityDetector | undefined;
    let cleanupStdout: (() => void) | undefined;

    if (titleMode === TitleMode.DYNAMIC) {
      activityDetector = new ActivityDetector(command);

      // Hook into stdout to detect Claude status
      const originalStdoutWrite = process.stdout.write.bind(process.stdout);

      // Create a proper override that handles all overloads
      const stdoutWriteOverride = function (
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
      };

      // Apply the override
      process.stdout.write = stdoutWriteOverride as typeof process.stdout.write;

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
