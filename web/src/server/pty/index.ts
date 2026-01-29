/**
 * PTY Module Entry Point
 *
 * This module exports all the PTY-related components for easy integration
 * with the existing server code.
 */

// Sub-modules (for advanced usage)
export { AsciinemaWriter } from './asciinema-writer.js';
export { IOHandler } from './io-handler.js';
export { IPCSocketHandler } from './ipc-socket-handler.js';
export { type CommandFinishedEvent, ProcessTracker } from './process-tracker.js';
export { ProcessUtils } from './process-utils.js';
// Main service interface
export { PtyManager } from './pty-manager.js';
export { initializeNodePty, isNodePtyInitialized, SessionLifecycle } from './session-lifecycle.js';
export { SessionManager } from './session-manager.js';
export { TitleManager } from './title-manager.js';

// Core types
export * from './types.js';

// Re-export for convenience
export { PtyError } from './types.js';
