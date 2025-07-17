#!/usr/bin/env pnpm exec tsx --no-deprecation

/**
 * Minimal test script for node-pty
 * Tests PTY spawning, terminal raw mode, stdin/stdout forwarding
 */

import * as pty from 'node-pty';
import { which } from 'node-pty/lib/utils';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Terminal state restoration
let originalStdinRawMode = false;
let ptyProcess: pty.IPty | null = null;

/**
 * Clean up and restore terminal state
 */
function cleanup() {
  // Restore terminal mode
  if (process.stdin.isTTY && originalStdinRawMode) {
    try {
      process.stdin.setRawMode(false);
    } catch (e) {
      // Ignore errors
    }
  }
  
  // Kill PTY process
  if (ptyProcess) {
    try {
      ptyProcess.kill();
    } catch (e) {
      // Process might already be dead
    }
    ptyProcess = null;
  }
  
  // Clear line and show cursor
  process.stdout.write('\r\n\x1b[?25h');
}

/**
 * Resolve command using shell-like logic
 */
function resolveCommand(args: string[]): { command: string; args: string[] } {
  if (args.length === 0) {
    throw new Error('No command specified');
  }

  const [cmd, ...cmdArgs] = args;

  // Try to find the command in PATH
  try {
    const resolved = which(cmd);
    if (resolved) {
      return { command: resolved, args: cmdArgs };
    }
  } catch (e) {
    // Command not found in PATH
  }

  // Check if it's a relative path that exists
  if (cmd.includes('/') || cmd.includes('\\')) {
    const fullPath = path.resolve(cmd);
    if (fs.existsSync(fullPath)) {
      return { command: fullPath, args: cmdArgs };
    }
  }

  // Check common shell aliases
  const shellAliases: Record<string, string[]> = {
    'll': ['ls', '-la'],
    'la': ['ls', '-la'],
    'l': ['ls', '-l'],
  };

  if (shellAliases[cmd]) {
    const [aliasCmd, ...aliasArgs] = shellAliases[cmd];
    return resolveCommand([aliasCmd, ...aliasArgs, ...cmdArgs]);
  }

  // Fallback to original command and let PTY handle it
  return { command: cmd, args: cmdArgs };
}

/**
 * Main function
 */
async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log('Usage: ./fwd-test.ts <command> [args...]');
    console.log('');
    console.log('Examples:');
    console.log('  ./fwd-test.ts bash');
    console.log('  ./fwd-test.ts ls -la');
    console.log('  ./fwd-test.ts python3 -i');
    process.exit(0);
  }

  try {
    // Resolve command
    const { command, args: resolvedArgs } = resolveCommand(args);
    console.log(`Spawning: ${command} ${resolvedArgs.join(' ')}`);
    console.log(`Working directory: ${process.cwd()}`);
    console.log('');

    // Get terminal size
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;

    // Spawn PTY
    ptyProcess = pty.spawn(command, resolvedArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.cwd(),
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      },
    });

    console.log(`PTY spawned with PID: ${ptyProcess.pid}`);
    console.log('Press Ctrl+C to exit\n');

    // Forward PTY output to stdout
    ptyProcess.onData((data: string) => {
      process.stdout.write(data);
    });

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode, signal }) => {
      console.log(`\nProcess exited with code ${exitCode}${signal ? ` (signal: ${signal})` : ''}`);
      cleanup();
      process.exit(exitCode || 0);
    });

    // Set terminal to raw mode
    if (process.stdin.isTTY) {
      originalStdinRawMode = process.stdin.isRaw;
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    // Forward stdin to PTY
    process.stdin.on('data', (data: Buffer) => {
      if (ptyProcess) {
        ptyProcess.write(data.toString());
      }
    });

    // Handle terminal resize
    process.stdout.on('resize', () => {
      if (ptyProcess) {
        const newCols = process.stdout.columns || 80;
        const newRows = process.stdout.rows || 24;
        ptyProcess.resize(newCols, newRows);
      }
    });

    // Handle signals for cleanup
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
    signals.forEach(signal => {
      process.on(signal, () => {
        console.log(`\nReceived ${signal}, cleaning up...`);
        cleanup();
        process.exit(1);
      });
    });

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      console.error('\nUncaught exception:', error);
      cleanup();
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      console.error('\nUnhandled rejection:', reason);
      cleanup();
      process.exit(1);
    });

  } catch (error) {
    console.error('Error:', error);
    cleanup();
    process.exit(1);
  }
}

// Run main function
main().catch((error) => {
  console.error('Fatal error:', error);
  cleanup();
  process.exit(1);
});