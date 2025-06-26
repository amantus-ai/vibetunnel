/**
 * Terminal Lifecycle Manager
 *
 * Handles terminal setup, initialization, resizing, and cleanup operations
 * for session view components.
 */

import { createLogger } from '../../utils/logger.js';
import type { Session } from '../session-list.js';
import type { Terminal } from '../terminal.js';
import type { ConnectionManager } from './connection-manager.js';
import type { InputManager } from './input-manager.js';

const _logger = createLogger('terminal-lifecycle-manager');

export class TerminalLifecycleManager {
  private session: Session | null = null;
  private terminal: Terminal | null = null;
  private connectionManager: ConnectionManager | null = null;
  private inputManager: InputManager | null = null;
  private connected = false;
  private terminalFontSize = 14;
  private terminalMaxCols = 0;
  private resizeTimeout: number | null = null;
  private lastResizeWidth = 0;
  private lastResizeHeight = 0;

  setSession(session: Session | null) {
    this.session = session;
  }

  setTerminal(terminal: Terminal | null) {
    this.terminal = terminal;
  }

  setConnectionManager(connectionManager: ConnectionManager | null) {
    this.connectionManager = connectionManager;
  }

  setInputManager(inputManager: InputManager | null) {
    this.inputManager = inputManager;
  }

  setConnected(connected: boolean) {
    this.connected = connected;
  }

  setTerminalFontSize(fontSize: number) {
    this.terminalFontSize = fontSize;
  }

  setTerminalMaxCols(maxCols: number) {
    this.terminalMaxCols = maxCols;
  }

  setupTerminal() {
    // Terminal element will be created in render()
    // We'll initialize it in updated() after first render
  }

  cleanup() {
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = null;
    }
  }
}
