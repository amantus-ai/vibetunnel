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
import { PtyManager } from './pty/index.js';
import { closeLogger, createLogger } from './utils/logger.js';
import { generateSessionName } from './utils/session-naming.js';
import { BUILD_DATE, GIT_COMMIT, VERSION } from './version.js';

const logger = createLogger('fwd');

function showUsage() {
  console.log(chalk.blue(`VibeTunnel Forward v${VERSION}`) + chalk.gray(` (${BUILD_DATE})`));
  console.log('');
  console.log('Usage:');
  console.log('  pnpm exec tsx src/fwd.ts [--session-id <id>] <command> [args...]');
  console.log('');
  console.log('Options:');
  console.log('  --session-id <id>   Use a pre-generated session ID');
  console.log('');
  console.log('Examples:');
  console.log('  pnpm exec tsx src/fwd.ts claude --resume');
  console.log('  pnpm exec tsx src/fwd.ts bash -l');
  console.log('  pnpm exec tsx src/fwd.ts python3 -i');
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

  // Check for --session-id parameter
  let sessionId: string | undefined;
  let remainingArgs = args;

  if (args[0] === '--session-id' && args.length > 1) {
    sessionId = args[1];
    remainingArgs = args.slice(2);
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

  const cwd = process.cwd();

  // Initialize PTY manager
  const controlPath = path.join(os.homedir(), '.vibetunnel', 'control');
  logger.debug(`Control path: ${controlPath}`);
  const ptyManager = new PtyManager(controlPath);

  // Store original terminal dimensions
  const originalCols = process.stdout.columns || 80;
  const originalRows = process.stdout.rows || 24;
  logger.debug(`Original terminal size: ${originalCols}x${originalRows}`);

  try {
    // Create a human-readable session name
    const sessionName = generateSessionName(command, cwd);

    // Pre-generate session ID if not provided
    const finalSessionId = sessionId || `fwd_${Date.now()}`;

    logger.log(`Creating session for command: ${command.join(' ')}`);
    logger.debug(`Session ID: ${finalSessionId}, working directory: ${cwd}`);

    const result = await ptyManager.createSession(command, {
      sessionId: finalSessionId,
      name: sessionName,
      workingDir: cwd,
      cols: originalCols,
      rows: originalRows,
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

        // Shutdown PTY manager and exit
        logger.debug('Shutting down PTY manager');
        await ptyManager.shutdown();

        // Force exit
        closeLogger();
        process.exit(exitCode || 0);
      },
    });

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

    // Set up terminal resize handler
    const resizeHandler = () => {
      const cols = process.stdout.columns || 80;
      const rows = process.stdout.rows || 24;
      logger.debug(`Terminal resized to ${cols}x${rows}`);

      // Send resize command through PTY manager
      try {
        ptyManager.resizeSession(result.sessionId, cols, rows);
      } catch (error) {
        logger.error('Failed to resize session:', error);
      }
    };

    // Listen for terminal resize events
    process.stdout.on('resize', resizeHandler);

    // Set up raw mode for terminal input
    if (process.stdin.isTTY) {
      logger.debug('Setting terminal to raw mode for input forwarding');
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    // The process will stay alive because stdin is in raw mode and resumed
  } catch (error) {
    logger.error('Failed to create or manage session:', error);

    closeLogger();
    process.exit(1);
  }
}
