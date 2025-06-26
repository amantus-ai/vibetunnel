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

const logger = createLogger('terminal-lifecycle-manager');

export interface TerminalEventHandlers {
  handleSessionExit: (e: Event) => void;
  handleTerminalResize: (e: Event) => void;
  handleTerminalPaste: (e: Event) => void;
}

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
  private domElement: Element | null = null;
  private eventHandlers: TerminalEventHandlers | null = null;

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

  setDomElement(element: Element | null) {
    this.domElement = element;
  }

  setEventHandlers(handlers: TerminalEventHandlers | null) {
    this.eventHandlers = handlers;
  }

  setupTerminal() {
    // Terminal element will be created in render()
    // We'll initialize it in updated() after first render
  }

  async initializeTerminal() {
    if (!this.domElement) {
      logger.warn('Cannot initialize terminal - missing DOM element');
      return;
    }

    const terminalElement = this.domElement.querySelector('vibe-terminal') as Terminal;
    if (!terminalElement || !this.session) {
      logger.warn(`Cannot initialize terminal - missing element or session`);
      return;
    }

    this.terminal = terminalElement;

    // Update connection manager with terminal reference
    if (this.connectionManager) {
      this.connectionManager.setTerminal(this.terminal);
      this.connectionManager.setSession(this.session);
    }

    // Configure terminal for interactive session
    this.terminal.cols = 80;
    this.terminal.rows = 24;
    this.terminal.fontSize = this.terminalFontSize; // Apply saved font size preference
    this.terminal.fitHorizontally = false; // Allow natural terminal sizing
    this.terminal.maxCols = this.terminalMaxCols; // Apply saved max width preference

    if (this.eventHandlers) {
      // Listen for session exit events
      this.terminal.addEventListener(
        'session-exit',
        this.eventHandlers.handleSessionExit as EventListener
      );

      // Listen for terminal resize events to capture dimensions
      this.terminal.addEventListener(
        'terminal-resize',
        this.eventHandlers.handleTerminalResize as unknown as EventListener
      );

      // Listen for paste events from terminal
      this.terminal.addEventListener(
        'terminal-paste',
        this.eventHandlers.handleTerminalPaste as EventListener
      );
    }

    // Connect to stream directly without artificial delays
    // Use setTimeout to ensure we're still connected after all synchronous updates
    setTimeout(() => {
      if (this.connected && this.connectionManager) {
        this.connectionManager.connectToStream();
      } else {
        logger.warn(`Component disconnected before stream connection`);
      }
    }, 0);
  }

  cleanup() {
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = null;
    }
  }
}
