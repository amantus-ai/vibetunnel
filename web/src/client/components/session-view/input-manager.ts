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
import { CJK_LANGUAGE_CODES, TERMINAL_IDS } from '../../utils/terminal-constants.js';
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
  private globalCompositionListener: ((e: CompositionEvent) => void) | null = null;

  setSession(session: Session | null): void {
    // Clean up IME input when session is null
    if (!session && this.imeInput) {
      this.cleanup();
    }

    this.session = session;

    // Setup IME input when session is available and CJK language is active
    if (session && !this.imeInput) {
      this.setupIMEInput();
    }

    // Set up global composition event listener to detect CJK input dynamically
    if (session && !detectMobile()) {
      this.setupGlobalCompositionListener();
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

  /**
   * Check if a CJK (Chinese, Japanese, Korean) language is currently active
   * This detects both system language and input method editor (IME) state
   */
  private isCJKLanguageActive(): boolean {
    // Check system/browser language first
    const languages = [navigator.language, ...(navigator.languages || [])];

    // Check if any of the user's languages are CJK
    const hasCJKLanguage = languages.some((lang) =>
      CJK_LANGUAGE_CODES.some((cjkLang) => lang.toLowerCase().startsWith(cjkLang.toLowerCase()))
    );

    if (hasCJKLanguage) {
      logger.log('CJK language detected in browser languages:', languages);
      return true;
    }

    // Additional check: look for common CJK input method indicators
    // This is more of a heuristic since there's no direct IME detection API
    const hasIMEKeyboard = this.hasIMEKeyboard();
    if (hasIMEKeyboard) {
      logger.log('IME keyboard detected, likely CJK input method');
      return true;
    }

    logger.log('No CJK language or IME detected', { languages, hasIMEKeyboard });
    return false;
  }

  /**
   * Heuristic check for IME keyboard presence
   * This is not 100% reliable but provides a reasonable fallback
   */
  private hasIMEKeyboard(): boolean {
    // Check for composition events support (indicates IME capability)
    if (!('CompositionEvent' in window)) {
      return false;
    }

    // Check if the virtual keyboard API indicates composition support
    if ('virtualKeyboard' in navigator) {
      try {
        const nav = navigator as Navigator & { virtualKeyboard?: { overlaysContent?: boolean } };
        const vk = nav.virtualKeyboard;
        // Some IME keyboards set overlaysContent to true
        if (vk && vk.overlaysContent !== undefined) {
          return true;
        }
      } catch (_e) {
        // Ignore errors accessing virtual keyboard API
      }
    }

    // Fallback: assume IME is possible if composition events are supported
    // and we're on a platform that commonly uses IME
    const userAgent = navigator.userAgent.toLowerCase();
    const isCommonIMEPlatform =
      userAgent.includes('windows') || userAgent.includes('mac') || userAgent.includes('linux');

    return isCommonIMEPlatform;
  }

  private setupIMEInput(retryCount = 0): void {
    const MAX_RETRIES = 10;
    const IME_SETUP_RETRY_DELAY_MS = 100;

    // Skip IME input setup on mobile devices (they have their own IME handling)
    if (detectMobile()) {
      logger.log('Skipping IME input setup on mobile device');
      return;
    }

    // Skip if IME input already exists
    if (this.imeInput) {
      logger.log('IME input already exists, skipping setup');
      return;
    }

    // Only enable IME input for CJK languages
    if (!this.isCJKLanguageActive()) {
      logger.log('Skipping IME input setup - no CJK language detected');
      return;
    }

    logger.log('Setting up IME input on desktop device for CJK language');

    // Check if terminal element exists first - if not, defer setup
    const terminalElement = this.callbacks?.getTerminalElement?.();
    if (!terminalElement) {
      if (retryCount >= MAX_RETRIES) {
        logger.error('Failed to setup IME after maximum retries');
        return;
      }
      logger.log(
        `Terminal element not ready yet, deferring IME setup (retry ${retryCount + 1}/${MAX_RETRIES})`
      );
      // Retry after a short delay when terminal should be ready
      setTimeout(() => {
        this.setupIMEInput(retryCount + 1);
      }, IME_SETUP_RETRY_DELAY_MS);
      return;
    }

    // Find the terminal container to position the IME input correctly
    const terminalContainer = document.getElementById(TERMINAL_IDS.SESSION_TERMINAL);
    if (!terminalContainer) {
      logger.warn('Terminal container not found, cannot setup IME input');
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
        // Get cursor position from the terminal element
        const terminalElement = this.callbacks?.getTerminalElement?.();
        if (!terminalElement) {
          return null;
        }

        // Check if the terminal element has getCursorInfo method
        if (
          'getCursorInfo' in terminalElement &&
          typeof terminalElement.getCursorInfo === 'function'
        ) {
          return terminalElement.getCursorInfo();
        }

        return null;
      },
      getFontSize: () => {
        // Get font size from the terminal element
        const terminalElement = this.callbacks?.getTerminalElement?.();
        if (!terminalElement) {
          return 14; // Default font size
        }

        // Check if the terminal element has fontSize property
        if ('fontSize' in terminalElement && typeof terminalElement.fontSize === 'number') {
          return terminalElement.fontSize;
        }

        return 14; // Default font size
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

    // Update IME input position after sending text
    this.refreshIMEPosition();
  }

  async sendControlSequence(controlChar: string): Promise<void> {
    // sendControlSequence is for control characters - always send as literal text
    // Control characters like '\x12' (Ctrl+R) should be sent directly
    await this.sendInputInternal({ text: controlChar }, 'send control sequence to session');

    // Update IME input position after sending control sequence
    this.refreshIMEPosition();
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

    // Update IME input position after sending input
    this.refreshIMEPosition();
  }

  private refreshIMEPosition(): void {
    // Update IME input position if it exists
    if (this.imeInput?.isFocused()) {
      // Update immediately first
      this.imeInput?.refreshPosition();

      // Debounced update after allowing terminal to update cursor position
      // Use a single setTimeout to avoid race conditions
      setTimeout(() => {
        this.imeInput?.refreshPosition();
      }, 50);
    }
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

    // Remove global composition listener
    if (this.globalCompositionListener) {
      document.removeEventListener('compositionstart', this.globalCompositionListener);
      this.globalCompositionListener = null;
    }

    // Disconnect WebSocket if feature was enabled
    if (this.useWebSocketInput) {
      websocketInputClient.disconnect();
    }

    // Clear references to prevent memory leaks
    this.session = null;
    this.callbacks = null;
  }

  /**
   * Retry IME setup - useful when terminal becomes ready after initial setup attempt
   */
  retryIMESetup(): void {
    if (!this.imeInput && !detectMobile()) {
      logger.log('Retrying IME setup after terminal became ready');
      this.setupIMEInput();
    }
  }

  /**
   * Set up a global composition event listener to detect CJK input dynamically
   * This allows enabling IME input when the user starts composing CJK text
   */
  private setupGlobalCompositionListener(): void {
    if (this.globalCompositionListener) {
      return; // Already set up
    }

    this.globalCompositionListener = (e: CompositionEvent) => {
      // Only enable IME input if it's not already set up
      if (!this.imeInput && this.session && !detectMobile()) {
        logger.log('Composition event detected, enabling IME input:', e.type, e.data);
        this.enableIMEInput();
      }
    };

    // Listen for composition start events globally
    document.addEventListener('compositionstart', this.globalCompositionListener);
  }

  /**
   * Enable IME input dynamically when CJK input is detected
   * This can be called when composition events are detected or user explicitly enables CJK input
   */
  enableIMEInput(): void {
    if (detectMobile()) {
      logger.log('Skipping IME input enable on mobile device');
      return;
    }

    if (this.imeInput) {
      logger.log('IME input already enabled');
      return;
    }

    if (!this.session) {
      logger.log('Cannot enable IME input - no session available');
      return;
    }

    logger.log('Dynamically enabling IME input for CJK composition');
    // Force enable by skipping the language check since composition was detected
    this.forceSetupIMEInput();
  }

  /**
   * Force setup IME input without language checks (used when composition is detected)
   */
  private forceSetupIMEInput(): void {
    const terminalContainer = document.getElementById(TERMINAL_IDS.SESSION_TERMINAL);
    if (!terminalContainer) {
      logger.warn('Terminal container not found, cannot setup IME input');
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
        // Get cursor position from the terminal element
        const terminalElement = this.callbacks?.getTerminalElement?.();
        if (!terminalElement) {
          return null;
        }

        // Check if the terminal element has getCursorInfo method
        if (
          'getCursorInfo' in terminalElement &&
          typeof terminalElement.getCursorInfo === 'function'
        ) {
          return terminalElement.getCursorInfo();
        }

        return null;
      },
      getFontSize: () => {
        // Get font size from the terminal element
        const terminalElement = this.callbacks?.getTerminalElement?.();
        if (!terminalElement) {
          return 14; // Default font size
        }

        // Check if the terminal element has fontSize property
        if ('fontSize' in terminalElement && typeof terminalElement.fontSize === 'number') {
          return terminalElement.fontSize;
        }

        return 14; // Default font size
      },
      autoFocus: true,
    });
  }

  // For testing purposes only
  getIMEInputForTesting(): DesktopIMEInput | null {
    return this.imeInput;
  }
}
