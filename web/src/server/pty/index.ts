/**
 * PTY Module Entry Point
 *
 * This module exports all the PTY-related components for easy integration
 * with the existing server code.
 */

// Main service interface
export { PtyManager } from './pty-manager.js';

// Sub-modules (for advanced usage)
export { AsciinemaWriter } from './asciinema-writer.js';
export { IOHandler } from './io-handler.js';
export { IPCSocketHandler } from './ipc-socket-handler.js';
export { ProcessTracker, type CommandFinishedEvent } from './process-tracker.js';
export { ProcessUtils } from './process-utils.js';
export { SessionLifecycle, initializeNodePty, isNodePtyInitialized } from './session-lifecycle.js';
export { SessionManager } from './session-manager.js';
export { TitleManager } from './title-manager.js';

// Core types
export * from './types.js';

// Re-export for convenience
export { PtyError } from './types.js';
