#!/usr/bin/env node
// Entry point for the server - imports the modular server which starts automatically

// Suppress xterm.js errors globally - must be before any other imports
import { suppressXtermErrors } from './shared/suppress-xterm-errors.js';

suppressXtermErrors();

import { startVibeTunnelForward } from './server/fwd.js';
import { startVibeTunnelServer } from './server/server.js';
import { closeLogger, createLogger, initLogger, VerbosityLevel } from './server/utils/logger.js';
import { parseVerbosityFromEnv } from './server/utils/verbosity-parser.js';
import { VERSION } from './server/version.js';

// Initialize logger before anything else
// Parse verbosity from environment variables
const verbosityLevel = parseVerbosityFromEnv();

// Check for legacy debug mode (for backward compatibility with initLogger)
const debugMode = process.env.VIBETUNNEL_DEBUG === '1' || process.env.VIBETUNNEL_DEBUG === 'true';

initLogger(debugMode, verbosityLevel);
const logger = createLogger('cli');

// Source maps are only included if built with --sourcemap flag

// Prevent double execution in SEA context where require.main might be undefined
// Use a global flag to ensure we only run once
interface GlobalWithVibetunnel {
  __vibetunnelStarted?: boolean;
}

const globalWithVibetunnel = global as unknown as GlobalWithVibetunnel;

if (globalWithVibetunnel.__vibetunnelStarted) {
  process.exit(0);
}
globalWithVibetunnel.__vibetunnelStarted = true;

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  logger.error('Stack trace:', error.stack);
  closeLogger();
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  if (reason instanceof Error) {
    logger.error('Stack trace:', reason.stack);
  }
  closeLogger();
  process.exit(1);
});

/**
 * Print help message with version and usage information
 */
function printHelp(): void {
  console.log(`VibeTunnel Server v${VERSION}`);
  console.log('');
  console.log('Usage:');
  console.log('  vibetunnel [options]                    Start VibeTunnel server');
  console.log('  vibetunnel fwd <session-id> <command>   Forward command to session');
  console.log('  vibetunnel systemd [action]             Manage systemd service (Linux)');
  console.log('  vibetunnel version                      Show version');
  console.log('  vibetunnel help                         Show this help');
  console.log('');
  console.log('Systemd Service Actions:');
  console.log('  install   - Install VibeTunnel as systemd service (default)');
  console.log('  uninstall - Remove VibeTunnel systemd service');
  console.log('  status    - Check systemd service status');
  console.log('');
  console.log('Examples:');
  console.log('  vibetunnel --port 8080 --no-auth');
  console.log('  vibetunnel fwd abc123 "ls -la"');
  console.log('  vibetunnel systemd');
  console.log('  vibetunnel systemd uninstall');
  console.log('');
  console.log('For more options, run: vibetunnel --help');
}

/**
 * Print version information
 */
function printVersion(): void {
  console.log(`VibeTunnel Server v${VERSION}`);
}

/**
 * Handle command forwarding to a session
 */
async function handleForwardCommand(): Promise<void> {
  try {
    await startVibeTunnelForward(process.argv.slice(3));
  } catch (error) {
    logger.error('Fatal error:', error);
    closeLogger();
    process.exit(1);
  }
}

/**
 * Handle systemd service installation and management
 */
async function handleSystemdService(): Promise<void> {
  try {
    // Import systemd installer dynamically to avoid loading it on every startup
    const { installSystemdService } = await import('./server/services/systemd-installer.js');
    const action = process.argv[3] || 'install';
    installSystemdService(action);
  } catch (error) {
    logger.error('Failed to load systemd installer:', error);
    closeLogger();
    process.exit(1);
  }
}

/**
 * Start the VibeTunnel server with optional startup logging
 */
function handleStartServer(): void {
  // Show startup message at INFO level or when debug is enabled
  if (verbosityLevel !== undefined && verbosityLevel >= VerbosityLevel.INFO) {
    logger.log('Starting VibeTunnel server...');
  }
  startVibeTunnelServer();
}

/**
 * Parse command line arguments and execute appropriate action
 */
async function parseCommandAndExecute(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case 'version':
      printVersion();
      process.exit(0);
      break;

    case 'help':
    case '--help':
    case '-h':
      printHelp();
      process.exit(0);
      break;

    case 'fwd':
      await handleForwardCommand();
      break;

    case 'systemd':
      await handleSystemdService();
      break;

    default:
      // No command provided - start the server
      handleStartServer();
      break;
  }
}

/**
 * Check if this module is being run directly (not imported)
 */
function isMainModule(): boolean {
  return (
    !module.parent &&
    (require.main === module ||
      require.main === undefined ||
      (require.main?.filename?.endsWith('/vibetunnel-cli') ?? false))
  );
}

// Main execution
if (isMainModule()) {
  parseCommandAndExecute().catch((error) => {
    logger.error('Unhandled error in main execution:', error);
    if (error instanceof Error) {
      logger.error('Stack trace:', error.stack);
    }
    closeLogger();
    process.exit(1);
  });
}
