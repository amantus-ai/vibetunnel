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
import { createLogger } from '../../utils/logger.js';
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

  setSession(session: Session | null): void {
    // Clean up IME input when session is null
    if (!session && this.imeInput) {
      this.cleanup();
    }

    this.session = session;

    // Setup IME input when session is available
    if (session && !this.imeInput) {
      this.setupIMEInput();
      // Focus the IME input after a short delay to ensure it's ready
      setTimeout(() => {
        // Validate session still exists and matches before focusing
        if (this.session === session && this.imeInput) {
          this.focusIMEInput();
        }
      }, 100);
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

  // IME composition state tracking
  private isComposing = false;
  private imeInput?: HTMLInputElement;
  private imeInputFocused = false;

  private setupIMEInput(): void {
    // Find the terminal container to position the IME input correctly
    const terminalContainer = document.getElementById('terminal-container');
    if (!terminalContainer) {
      console.warn('🌏 InputManager: Terminal container not found, cannot setup IME input');
      return;
    }

    // Create visible input for IME composition positioned at cursor
    this.imeInput = document.createElement('input');
    this.imeInput.type = 'text';
    this.imeInput.style.position = 'absolute';
    // Position will be updated dynamically based on cursor position
    this.imeInput.style.top = '0px';
    this.imeInput.style.left = '0px';
    this.imeInput.style.transform = 'none';
    // Make input invisible but functional for IME
    this.imeInput.style.width = '1px';
    this.imeInput.style.height = '1px';
    this.imeInput.style.fontSize = '16px';
    this.imeInput.style.padding = '0';
    this.imeInput.style.border = 'none';
    this.imeInput.style.borderRadius = '0';
    this.imeInput.style.backgroundColor = 'transparent';
    this.imeInput.style.color = 'transparent';
    this.imeInput.style.zIndex = '1000';
    this.imeInput.style.opacity = '0';
    this.imeInput.style.pointerEvents = 'none';
    this.imeInput.placeholder = 'CJK Input';
    this.imeInput.autocapitalize = 'off';
    this.imeInput.setAttribute('autocorrect', 'off');
    this.imeInput.autocomplete = 'off';
    this.imeInput.spellcheck = false;

    // Append to terminal container instead of document.body
    terminalContainer.appendChild(this.imeInput);

    // Handle IME composition events
    this.imeInput.addEventListener('compositionstart', this.handleCompositionStart);
    this.imeInput.addEventListener('compositionupdate', this.handleCompositionUpdate);
    this.imeInput.addEventListener('compositionend', this.handleCompositionEnd);
    this.imeInput.addEventListener('input', this.handleIMEInput);

    // Handle special keys in the IME input
    this.imeInput.addEventListener('keydown', this.handleIMEKeydown);
    this.imeInput.addEventListener('keyup', this.handleIMEKeyup);

    // Handle paste events directly on IME input
    this.imeInput.addEventListener('paste', this.handleIMEPaste);

    // Track focus state
    this.imeInput.addEventListener('focus', () => {
      this.imeInputFocused = true;
      document.body.setAttribute('data-ime-input-focused', 'true');
    });

    this.imeInput.addEventListener('blur', () => {
      this.imeInputFocused = false;
      document.body.removeAttribute('data-ime-input-focused');
    });

    // Focus IME input when document is clicked
    document.addEventListener('click', this.handleDocumentClick);

    // Add global paste handler for Cmd+V support
    document.addEventListener('paste', this.handleGlobalPaste);

    // Update position but don't auto-focus immediately
    this.updateIMEInputPosition();
  }

  private handleDocumentClick = (e: Event) => {
    // Only focus IME input if clicking in the terminal area
    const target = e.target as HTMLElement;
    const terminalContainer = document.getElementById('terminal-container');
    if (terminalContainer && (terminalContainer.contains(target) || target === terminalContainer)) {
      // Focus IME input for terminal clicks, which enables IME input
      this.focusIMEInput();
    }
  };

  private focusIMEInput(): void {
    if (this.imeInput) {
      // Update position before focusing
      this.updateIMEInputPosition();

      // Focus immediately and also with a small delay to ensure it sticks
      this.imeInput.focus();
      setTimeout(() => {
        if (this.imeInput && document.activeElement !== this.imeInput) {
          this.imeInput.focus();
        }
      }, 10);
    }
  }

  private updateIMEInputPosition(): void {
    if (!this.imeInput || !this.callbacks?.getTerminalElement) return;

    const terminalElement = this.callbacks.getTerminalElement();
    if (!terminalElement) return;

    try {
      // Get cursor info using public method
      const cursorInfo = terminalElement.getCursorInfo();
      if (!cursorInfo) {
        console.warn('🌏 InputManager: Cannot get cursor info, using fallback positioning');
        this.imeInput.style.left = '10px';
        this.imeInput.style.bottom = '10px';
        this.imeInput.style.top = 'auto';
        return;
      }

      const { cursorX, cursorY, cols, rows } = cursorInfo;

      // Get terminal dimensions
      const terminalContainer = document.getElementById('terminal-container');
      if (!terminalContainer) return;

      const containerRect = terminalContainer.getBoundingClientRect();
      const terminalRect = terminalElement.getBoundingClientRect();

      // Calculate character dimensions (approximate)
      const charWidth = terminalRect.width / cols;
      const lineHeight = terminalRect.height / rows;

      // Calculate pixel position relative to terminal container
      const pixelX = terminalRect.left - containerRect.left + cursorX * charWidth;
      const pixelY = terminalRect.top - containerRect.top + cursorY * lineHeight + lineHeight;

      // Position IME input at cursor location
      this.imeInput.style.left = `${Math.max(10, pixelX)}px`;
      this.imeInput.style.top = `${Math.max(10, pixelY)}px`;

      // Position updated successfully
    } catch (error) {
      console.warn('🌏 InputManager: Failed to update IME position:', error);
      // Fallback to bottom-left positioning
      this.imeInput.style.left = '10px';
      this.imeInput.style.bottom = '10px';
      this.imeInput.style.top = 'auto';
    }
  }

  private handleCompositionStart = () => {
    this.isComposing = true;
    document.body.setAttribute('data-ime-composing', 'true');
    // Update position when composition starts to ensure it's at current cursor
    this.updateIMEInputPosition();
  };

  private handleCompositionUpdate = (_e: CompositionEvent) => {
    // IME composition in progress
  };

  private handleCompositionEnd = (e: CompositionEvent) => {
    this.isComposing = false;
    document.body.removeAttribute('data-ime-composing');

    // Send the final composed text
    const finalText = e.data;
    if (finalText) {
      this.sendInputText(finalText);
    }

    // Clear the input
    if (this.imeInput) {
      this.imeInput.value = '';
    }
  };

  private handleIMEPaste = (e: ClipboardEvent) => {
    // Get pasted text from clipboard
    const pastedText = e.clipboardData?.getData('text');
    if (pastedText) {
      // Send pasted text directly to terminal buffer
      this.sendInputText(pastedText);
      // Clear the input to prevent duplication
      if (this.imeInput) {
        this.imeInput.value = '';
      }
      // Prevent default paste behavior to avoid duplication
      e.preventDefault();
    }
  };

  private handleGlobalPaste = (e: ClipboardEvent) => {
    // Handle paste events globally when they don't reach the IME input
    // This covers cases when IME input doesn't have focus or when using regular typing
    const target = e.target as HTMLElement;

    // If the paste is already handled by the IME input, let it handle it
    if (target === this.imeInput) {
      return; // Let handleIMEPaste handle it
    }

    // Only handle paste if we're in the session area (not in other inputs)
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.contentEditable === 'true' ||
      target.closest('.monaco-editor') ||
      target.closest('[data-keybinding-context]')
    ) {
      return; // Let other input elements handle their own paste
    }

    const pastedText = e.clipboardData?.getData('text');
    if (pastedText) {
      this.sendInputText(pastedText);
      e.preventDefault();
    }
  };

  private handleIMEKeyup = (_e: KeyboardEvent) => {
    // No special handling needed for key up events
  };

  private handleIMEKeydown = (e: KeyboardEvent) => {
    // Handle Cmd+V / Ctrl+V - let browser handle paste naturally
    if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
      // Don't prevent default - let the browser handle the paste event naturally
      // The paste event will be caught by handleIMEPaste
      return;
    }

    // During IME composition, let the browser handle ALL keys (including Enter)
    // This allows Enter to confirm IME candidates properly
    if (this.isComposing) {
      return; // Let browser handle it
    }

    // Only when NOT composing, handle Enter to send to terminal
    if (e.key === 'Enter') {
      e.preventDefault();
      // Send current text if any, then send Enter
      if (this.imeInput?.value.trim()) {
        this.sendInputText(this.imeInput.value);
        this.imeInput.value = '';
      }
      this.sendInput('enter');
      return;
    }

    // Allow other special keys (Backspace, Arrow keys, etc.) to work normally in the input
  };

  private handleIMEInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const text = input.value;

    // Skip if composition is active - wait for compositionend
    if (this.isComposing) {
      return;
    }

    // Handle regular typing (non-IME)
    if (text) {
      this.sendInputText(text);
      input.value = '';
    }
  };

  async handleKeyboardInput(e: KeyboardEvent): Promise<void> {
    if (!this.session) return;

    // Block keyboard events when IME input is focused, except for editing keys
    if (this.imeInputFocused) {
      const allowedKeys = [
        'Backspace',
        'Delete',
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
        'Tab',
      ];
      // Allow all Cmd/Ctrl combinations (including Cmd+V)
      if (!allowedKeys.includes(e.key) && !e.metaKey && !e.ctrlKey) {
        return;
      }
    }

    // Block keyboard events during IME composition
    if (this.isComposing) {
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
      target.closest('.monaco-editor') ||
      target.closest('[data-keybinding-context]') ||
      target.closest('.editor-container') ||
      target.closest('inline-edit') // Allow typing in inline-edit component
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
    if (
      e.key === 'F12' ||
      (!navigator.platform.toLowerCase().includes('mac') &&
        e.ctrlKey &&
        e.shiftKey &&
        e.key === 'I') ||
      (navigator.platform.toLowerCase().includes('mac') && e.metaKey && e.altKey && e.key === 'I')
    ) {
      return true;
    }

    // Always allow window switching
    if ((e.altKey || e.metaKey) && e.key === 'Tab') {
      return true;
    }

    // Get keyboard capture state
    const captureActive = this.callbacks?.getKeyboardCaptureActive?.() ?? true;

    // If capture is disabled, allow common browser shortcuts
    if (!captureActive) {
      const isMacOS = navigator.platform.toLowerCase().includes('mac');
      const key = e.key.toLowerCase();

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

      // Word navigation on macOS when capture is disabled
      if (isMacOS && e.metaKey && e.altKey && ['arrowleft', 'arrowright'].includes(key)) {
        return true;
      }
    }

    // When capture is active, everything else goes to terminal
    return false;
  }

  cleanup(): void {
    // Cleanup IME input
    if (this.imeInput) {
      this.imeInput.removeEventListener('compositionstart', this.handleCompositionStart);
      this.imeInput.removeEventListener('compositionupdate', this.handleCompositionUpdate);
      this.imeInput.removeEventListener('compositionend', this.handleCompositionEnd);
      this.imeInput.removeEventListener('input', this.handleIMEInput);
      this.imeInput.removeEventListener('keydown', this.handleIMEKeydown);
      this.imeInput.removeEventListener('keyup', this.handleIMEKeyup);
      this.imeInput.removeEventListener('paste', this.handleIMEPaste);
      document.removeEventListener('click', this.handleDocumentClick);
      document.removeEventListener('paste', this.handleGlobalPaste);
      // Clean up focus tracking attributes
      document.body.removeAttribute('data-ime-input-focused');
      document.body.removeAttribute('data-ime-composing');
      this.imeInput.remove();
      this.imeInput = undefined;
      this.imeInputFocused = false;
    }

    // Disconnect WebSocket if feature was enabled
    if (this.useWebSocketInput) {
      websocketInputClient.disconnect();
    }

    // Clear references to prevent memory leaks
    this.session = null;
    this.callbacks = null;
  }
}
