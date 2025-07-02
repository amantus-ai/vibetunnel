#!/usr/bin/env node
// Entry point for the server - imports the modular server which starts automatically

// Suppress xterm.js errors globally - must be before any other imports
import { suppressXtermErrors } from './shared/suppress-xterm-errors.js';

suppressXtermErrors();

import { startVibeTunnelForward } from './server/fwd.js';
import { startVibeTunnelServer } from './server/server.js';
import { closeLogger, createLogger, initLogger } from './server/utils/logger.js';
import { VERSION } from './server/version.js';

// Initialize logger before anything else
// Check VIBETUNNEL_DEBUG environment variable for debug mode
const debugMode = process.env.VIBETUNNEL_DEBUG === '1' || process.env.VIBETUNNEL_DEBUG === 'true';
initLogger(debugMode);
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

// Only execute if this is the main module (or in SEA where require.main is undefined)
if (!module.parent && (require.main === module || require.main === undefined)) {
  if (process.argv[2] === 'version') {
    console.log(`VibeTunnel Server v${VERSION}`);
    process.exit(0);
  } else if (process.argv[2] === 'fwd') {
    startVibeTunnelForward(process.argv.slice(3)).catch((error) => {
      logger.error('Fatal error:', error);
      closeLogger();
      process.exit(1);
    });
  } else {
    logger.log('Starting VibeTunnel server...');
    startVibeTunnelServer();
  }
}
