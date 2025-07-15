/**
 * Terminal Lifecycle Manager
 *
 * Handles terminal setup, initialization, resizing, and cleanup operations
 * for session view components.
 */

import { authClient } from '../../services/auth-client.js';
import { createLogger } from '../../utils/logger.js';
import type { TerminalThemeId } from '../../utils/terminal-themes.js';
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

export interface TerminalStateCallbacks {
  updateTerminalDimensions: (cols: number, rows: number) => void;
}

export class TerminalLifecycleManager {
  private session: Session | null = null;
  private terminal: Terminal | null = null;
  private connectionManager: ConnectionManager | null = null;
  private inputManager: InputManager | null = null;
  private connected = false;
  private terminalFontSize = 14;
  private terminalMaxCols = 0;
  private terminalTheme: TerminalThemeId = 'auto';
  private resizeTimeout: number | null = null;
  private lastResizeWidth = 0;
  private lastResizeHeight = 0;
  private domElement: Element | null = null;
  private eventHandlers: TerminalEventHandlers | null = null;
  private stateCallbacks: TerminalStateCallbacks | null = null;

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

  setTerminalTheme(theme: TerminalThemeId) {
    this.terminalTheme = theme;
  }

  getTerminal(): Terminal | null {
    return this.terminal;
  }

  setDomElement(element: Element | null) {
    this.domElement = element;
  }

  setEventHandlers(handlers: TerminalEventHandlers | null) {
    this.eventHandlers = handlers;
  }

  setStateCallbacks(callbacks: TerminalStateCallbacks | null) {
    this.stateCallbacks = callbacks;
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
    this.terminal.theme = this.terminalTheme;

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

  async handleTerminalResize(event: Event) {
    const customEvent = event as CustomEvent;
    // Update terminal dimensions for display
    const { cols, rows, isMobile, isHeightOnlyChange, source } = customEvent.detail;

    // Notify the session view to update its state
    if (this.stateCallbacks) {
      this.stateCallbacks.updateTerminalDimensions(cols, rows);
    }

    // On mobile, skip sending height-only changes to the server (keyboard events)
    if (isMobile && isHeightOnlyChange) {
      logger.debug(
        `skipping mobile height-only resize to server: ${cols}x${rows} (source: ${source})`
      );
      return;
    }

    // Debounce resize requests to prevent jumpiness
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }

    this.resizeTimeout = window.setTimeout(async () => {
      // Only send resize request if dimensions actually changed
      if (cols === this.lastResizeWidth && rows === this.lastResizeHeight) {
        logger.debug(`skipping redundant resize request: ${cols}x${rows}`);
        return;
      }

      // Send resize request to backend if session is active
      if (this.session && this.session.status !== 'exited') {
        try {
          logger.debug(
            `sending resize request: ${cols}x${rows} (was ${this.lastResizeWidth}x${this.lastResizeHeight})`
          );

          const response = await fetch(`/api/sessions/${this.session.id}/resize`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...authClient.getAuthHeader(),
            },
            body: JSON.stringify({ cols: cols, rows: rows }),
          });

          if (response.ok) {
            // Cache the successfully sent dimensions
            this.lastResizeWidth = cols;
            this.lastResizeHeight = rows;
          } else {
            logger.warn(`failed to resize session: ${response.status}`);
          }
        } catch (error) {
          logger.warn('failed to send resize request', error);
        }
      }
    }, 250) as unknown as number; // 250ms debounce delay
  }

  handleTerminalPaste(e: Event) {
    const customEvent = e as CustomEvent;
    const text = customEvent.detail?.text;
    if (text && this.session && this.inputManager) {
      this.inputManager.sendInputText(text);
    }
  }

  async resetTerminalSize() {
    if (!this.session) {
      logger.warn('resetTerminalSize called but no session available');
      return;
    }

    logger.log('Sending reset-size request for session', this.session.id);

    try {
      const response = await fetch(`/api/sessions/${this.session.id}/reset-size`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authClient.getAuthHeader(),
        },
      });

      if (!response.ok) {
        logger.error('failed to reset terminal size', {
          status: response.status,
          sessionId: this.session.id,
        });
      } else {
        logger.log('terminal size reset successfully for session', this.session.id);
      }
    } catch (error) {
      logger.error('error resetting terminal size', {
        error,
        sessionId: this.session.id,
      });
    }
  }

  cleanup() {
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = null;
    }
  }
}
