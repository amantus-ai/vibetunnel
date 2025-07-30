/**
 * Input Manager for Session View
 *
 * Handles keyboard input, special key combinations, and input routing
 * for terminal sessions.
 */

import type { Session } from '../../../shared/types.js';
import { authClient } from '../../services/auth-client.js';
import { websocketInputClient } from '../../services/websocket-input-client.js';
import { isBrowserShortcut, isCopyPasteShortcut } from '../../utils/browser-shortcuts.js';
import { consumeEvent } from '../../utils/event-utils.js';
import { isIMEAllowedKey } from '../../utils/ime-constants.js';
import { createLogger } from '../../utils/logger.js';
import { detectMobile } from '../../utils/mobile-utils.js';
import { DesktopIMEInput } from '../ime-input.js';
import type { Terminal } from '../terminal.js';
import type { VibeTerminalBinary } from '../vibe-terminal-binary.js';

const logger = createLogger('input-manager');

export interface InputManagerCallbacks {
  requestUpdate(): void;
  getKeyboardCaptureActive?(): boolean;
  getTerminalElement?(): Terminal | VibeTerminalBinary | null; // For cursor position access
}

export class InputManager {
  private session: Session | null = null;
  private callbacks: InputManagerCallbacks | null = null;
  private useWebSocketInput = true; // Feature flag for WebSocket input
  private lastEscapeTime = 0;
  private readonly DOUBLE_ESCAPE_THRESHOLD = 500; // ms
  private imeInput: DesktopIMEInput | null = null;

  setSession(session: Session | null): void {
    // Clean up IME input when session is null
    if (!session && this.imeInput) {
      this.cleanup();
    }

    this.session = session;

    // Setup IME input when session is available
    if (session && !this.imeInput) {
      this.setupIMEInput();
    }

    // Check URL parameter for WebSocket input feature flag
    const urlParams = new URLSearchParams(window.location.search);
    const socketInputParam = urlParams.get('socket_input');
    if (socketInputParam !== null) {
      this.useWebSocketInput = socketInputParam === 'true';
      logger.log(
        `WebSocket input ${this.useWebSocketInput ? 'enabled' : 'disabled'} via URL parameter`
      );
    }

    // Connect to WebSocket when session is set (if feature enabled)
    if (session && this.useWebSocketInput) {
      websocketInputClient.connect(session).catch((error) => {
        logger.debug('WebSocket connection failed, will use HTTP fallback:', error);
      });
    }
  }

  setCallbacks(callbacks: InputManagerCallbacks): void {
    this.callbacks = callbacks;
  }

  private setupIMEInput(): void {
    // Skip IME input setup on mobile devices (they have their own IME handling)
    if (detectMobile()) {
      console.log('🔍 Skipping IME input setup on mobile device');
      logger.log('Skipping IME input setup on mobile device');
      return;
    }
    console.log('🔍 Setting up IME input on desktop device');

    // Find the terminal container to position the IME input correctly
    const terminalContainer = document.getElementById('terminal-container');
    if (!terminalContainer) {
      console.warn('🌏 InputManager: Terminal container not found, cannot setup IME input');
      return;
    }

    // Create IME input component
    this.imeInput = new DesktopIMEInput({
      container: terminalContainer,
      onTextInput: (text: string) => {
        this.sendInputText(text);
      },
      onSpecialKey: (key: string) => {
        this.sendInput(key);
      },
      getCursorInfo: () => {
        // For now, return null to use fallback positioning
        // TODO: Implement cursor position tracking when Terminal/VibeTerminalBinary support it
        return null;
      },
      autoFocus: true,
    });
  }

  async handleKeyboardInput(e: KeyboardEvent): Promise<void> {
    if (!this.session) return;

    // Block keyboard events when IME input is focused, except for editing keys
    if (this.imeInput?.isFocused()) {
      if (!isIMEAllowedKey(e)) {
        return;
      }
    }

    // Block keyboard events during IME composition
    if (this.imeInput?.isComposingText()) {
      return;
    }

    const { key, ctrlKey, altKey, metaKey, shiftKey } = e;

    // Handle Escape key specially for exited sessions
    if (key === 'Escape' && this.session.status === 'exited') {
      return; // Let parent component handle back navigation
    }

    // Don't send input to exited sessions
    if (this.session.status === 'exited') {
      logger.log('ignoring keyboard input - session has exited');
      return;
    }

    // Allow standard browser copy/paste shortcuts
    if (isCopyPasteShortcut(e)) {
      // Allow standard browser copy/paste to work
      return;
    }

    // Handle Alt+ combinations
    if (altKey && !ctrlKey && !metaKey && !shiftKey) {
      // Alt+Left Arrow - Move to previous word
      if (key === 'ArrowLeft') {
        consumeEvent(e);
        await this.sendInput('\x1bb'); // ESC+b
        return;
      }
      // Alt+Right Arrow - Move to next word
      if (key === 'ArrowRight') {
        consumeEvent(e);
        await this.sendInput('\x1bf'); // ESC+f
        return;
      }
      // Alt+Backspace - Delete word backward
      if (key === 'Backspace') {
        consumeEvent(e);
        await this.sendInput('\x17'); // Ctrl+W
        return;
      }
    }

    let inputText = '';

    // Handle special keys
    switch (key) {
      case 'Enter':
        if (ctrlKey) {
          // Ctrl+Enter - send to tty-fwd for proper handling
          inputText = 'ctrl_enter';
        } else if (shiftKey) {
          // Shift+Enter - send to tty-fwd for proper handling
          inputText = 'shift_enter';
        } else {
          inputText = 'enter';
        }
        break;
      case 'Escape': {
        // Handle double-escape for keyboard capture toggle
        const now = Date.now();
        const timeSinceLastEscape = now - this.lastEscapeTime;

        if (timeSinceLastEscape < this.DOUBLE_ESCAPE_THRESHOLD) {
          // Double escape detected - toggle keyboard capture
          logger.log('🔄 Double Escape detected in input manager - toggling keyboard capture');

          // Dispatch event to parent to toggle capture
          if (this.callbacks) {
            // Create a synthetic capture-toggled event
            const currentCapture = this.callbacks.getKeyboardCaptureActive?.() ?? true;
            const newCapture = !currentCapture;

            // Dispatch custom event that will bubble up
            const event = new CustomEvent('capture-toggled', {
              detail: { active: newCapture },
              bubbles: true,
              composed: true,
            });

            // Dispatch on document to ensure it reaches the app
            document.dispatchEvent(event);
          }

          this.lastEscapeTime = 0; // Reset to prevent triple-tap
          return; // Don't send this escape to terminal
        }

        this.lastEscapeTime = now;
        inputText = 'escape';
        break;
      }
      case 'ArrowUp':
        inputText = 'arrow_up';
        break;
      case 'ArrowDown':
        inputText = 'arrow_down';
        break;
      case 'ArrowLeft':
        inputText = 'arrow_left';
        break;
      case 'ArrowRight':
        inputText = 'arrow_right';
        break;
      case 'Tab':
        inputText = shiftKey ? 'shift_tab' : 'tab';
        break;
      case 'Backspace':
        inputText = 'backspace';
        break;
      case 'Delete':
        inputText = 'delete';
        break;
      case ' ':
        inputText = ' ';
        break;
      default:
        // Handle regular printable characters
        if (key.length === 1) {
          inputText = key;
        } else {
          // Ignore other special keys
          return;
        }
        break;
    }

    // Handle Ctrl combinations (but not if we already handled Ctrl+Enter above)
    if (ctrlKey && key.length === 1 && key !== 'Enter') {
      const charCode = key.toLowerCase().charCodeAt(0);
      if (charCode >= 97 && charCode <= 122) {
        // a-z
        inputText = String.fromCharCode(charCode - 96); // Ctrl+A = \x01, etc.
      }
    }

    // Send the input to the session
    await this.sendInput(inputText);
  }

  private async sendInputInternal(
    input: { text?: string; key?: string },
    errorContext: string
  ): Promise<void> {
    if (!this.session) return;

    try {
      // Try WebSocket first if feature enabled - non-blocking (connection should already be established)
      if (this.useWebSocketInput) {
        const sentViaWebSocket = websocketInputClient.sendInput(input);

        if (sentViaWebSocket) {
          // Successfully sent via WebSocket, no need for HTTP fallback
          return;
        }
      }

      // Fallback to HTTP if WebSocket failed
      logger.debug('WebSocket unavailable, falling back to HTTP');
      const response = await fetch(`/api/sessions/${this.session.id}/input`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authClient.getAuthHeader(),
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        if (response.status === 400) {
          logger.log('session no longer accepting input (likely exited)');
          // Update session status to exited
          if (this.session) {
            this.session.status = 'exited';
            // Trigger UI update through callbacks
            if (this.callbacks) {
              this.callbacks.requestUpdate();
            }
          }
        } else {
          logger.error(`failed to ${errorContext}`, { status: response.status });
        }
      }
    } catch (error) {
      logger.error(`error ${errorContext}`, error);
    }
  }

  async sendInputText(text: string): Promise<void> {
    // sendInputText is used for pasted content - always treat as literal text
    // Never interpret pasted text as special keys to avoid ambiguity
    await this.sendInputInternal({ text }, 'send input to session');
  }

  async sendControlSequence(controlChar: string): Promise<void> {
    // sendControlSequence is for control characters - always send as literal text
    // Control characters like '\x12' (Ctrl+R) should be sent directly
    await this.sendInputInternal({ text: controlChar }, 'send control sequence to session');
  }

  async sendInput(inputText: string): Promise<void> {
    // Determine if we should send as key or text
    const specialKeys = [
      'enter',
      'escape',
      'backspace',
      'tab',
      'shift_tab',
      'arrow_up',
      'arrow_down',
      'arrow_left',
      'arrow_right',
      'ctrl_enter',
      'shift_enter',
      'page_up',
      'page_down',
      'home',
      'end',
      'delete',
      'f1',
      'f2',
      'f3',
      'f4',
      'f5',
      'f6',
      'f7',
      'f8',
      'f9',
      'f10',
      'f11',
      'f12',
    ];

    const input = specialKeys.includes(inputText) ? { key: inputText } : { text: inputText };
    await this.sendInputInternal(input, 'send input to session');
  }

  isKeyboardShortcut(e: KeyboardEvent): boolean {
    // Check if we're typing in an input field or editor
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.contentEditable === 'true' ||
      target.closest?.('.monaco-editor') ||
      target.closest?.('[data-keybinding-context]') ||
      target.closest?.('.editor-container') ||
      target.closest?.('inline-edit') // Allow typing in inline-edit component
    ) {
      // Special exception: allow copy/paste shortcuts even in input fields (like our IME input)
      if (isCopyPasteShortcut(e)) {
        return true;
      }
      // Allow normal input in form fields and editors for other keys
      return false;
    }

    // Check if this is a critical browser shortcut
    if (isBrowserShortcut(e)) {
      return true;
    }

    // Always allow DevTools shortcuts
    const isMac =
      /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent) ||
      (navigator.platform && navigator.platform.indexOf('Mac') >= 0);
    if (
      e.key === 'F12' ||
      (!isMac && e.ctrlKey && e.shiftKey && e.key === 'I') ||
      (isMac && e.metaKey && e.altKey && e.key === 'I')
    ) {
      return true;
    }

    // Always allow window switching
    if ((e.altKey || e.metaKey) && e.key === 'Tab') {
      return true;
    }

    // Word navigation on macOS should always be allowed (system-wide shortcut)
    const isMacOS =
      /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent) ||
      (navigator.platform && navigator.platform.indexOf('Mac') >= 0);
    const key = e.key.toLowerCase();
    if (isMacOS && e.metaKey && e.altKey && ['arrowleft', 'arrowright'].includes(key)) {
      return true;
    }

    // Get keyboard capture state
    const captureActive = this.callbacks?.getKeyboardCaptureActive?.() ?? true;

    // If capture is disabled, allow common browser shortcuts
    if (!captureActive) {
      // Common browser shortcuts that are normally captured for terminal
      if (isMacOS && e.metaKey && !e.shiftKey && !e.altKey) {
        if (['a', 'f', 'r', 'l', 'p', 's', 'd'].includes(key)) {
          return true;
        }
      }

      if (!isMacOS && e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (['a', 'f', 'r', 'l', 'p', 's', 'd'].includes(key)) {
          return true;
        }
      }
    }

    // When capture is active, everything else goes to terminal
    return false;
  }

  cleanup(): void {
    // Cleanup IME input
    if (this.imeInput) {
      this.imeInput.cleanup();
      this.imeInput = null;
    }

    // Disconnect WebSocket if feature was enabled
    if (this.useWebSocketInput) {
      websocketInputClient.disconnect();
    }

    // Clear references to prevent memory leaks
    this.session = null;
    this.callbacks = null;
  }

  // For testing purposes only
  getIMEInputForTesting(): DesktopIMEInput | null {
    return this.imeInput;
  }
}
