/**
 * Input Manager for Session View
 *
 * Handles keyboard input, special key combinations, and input routing
 * for terminal sessions.
 */

import { authClient } from '../../services/auth-client.js';
import { createLogger } from '../../utils/logger.js';
import type { Session } from '../session-list.js';

const logger = createLogger('input-manager');

export interface InputManagerCallbacks {
  requestUpdate(): void;
}

export class InputManager {
  private session: Session | null = null;
  private callbacks: InputManagerCallbacks | null = null;

  setSession(session: Session | null): void {
    this.session = session;
  }

  setCallbacks(callbacks: InputManagerCallbacks): void {
    this.callbacks = callbacks;
  }

  async handleKeyboardInput(e: KeyboardEvent): Promise<void> {
    if (!this.session) return;

    // Handle Escape key specially for exited sessions
    if (e.key === 'Escape' && this.session.status === 'exited') {
      return; // Let parent component handle back navigation
    }

    // Don't send input to exited sessions
    if (this.session.status === 'exited') {
      logger.log('ignoring keyboard input - session has exited');
      return;
    }

    // Allow standard browser copy/paste shortcuts
    const isMacOS = navigator.platform.toLowerCase().includes('mac');
    const isStandardPaste =
      (isMacOS && e.metaKey && e.key === 'v' && !e.ctrlKey && !e.shiftKey) ||
      (!isMacOS && e.ctrlKey && e.key === 'v' && !e.shiftKey);
    const isStandardCopy =
      (isMacOS && e.metaKey && e.key === 'c' && !e.ctrlKey && !e.shiftKey) ||
      (!isMacOS && e.ctrlKey && e.key === 'c' && !e.shiftKey);

    if (isStandardPaste || isStandardCopy) {
      // Allow standard browser copy/paste to work
      return;
    }

    let inputText = '';

    // Handle special keys
    switch (e.key) {
      case 'Enter':
        if (e.ctrlKey) {
          // Ctrl+Enter - send to tty-fwd for proper handling
          inputText = 'ctrl_enter';
        } else if (e.shiftKey) {
          // Shift+Enter - send to tty-fwd for proper handling
          inputText = 'shift_enter';
        } else {
          // Regular Enter
          inputText = 'enter';
        }
        break;
      case 'Escape':
        inputText = 'escape';
        break;
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
        inputText = e.shiftKey ? 'shift_tab' : 'tab';
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
        if (e.key.length === 1) {
          inputText = e.key;
        } else {
          // Ignore other special keys
          return;
        }
        break;
    }

    // Handle Ctrl combinations (but not if we already handled Ctrl+Enter above)
    if (e.ctrlKey && e.key.length === 1 && e.key !== 'Enter') {
      const charCode = e.key.toLowerCase().charCodeAt(0);
      if (charCode >= 97 && charCode <= 122) {
        // a-z
        inputText = String.fromCharCode(charCode - 96); // Ctrl+A = \x01, etc.
      }
    }

    // Send the input to the session
    await this.sendInput(inputText);
  }

  async sendInputText(text: string): Promise<void> {
    if (!this.session) return;

    try {
      // Determine if we should send as key or text
      const body = [
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
      ].includes(text)
        ? { key: text }
        : { text };

      const response = await fetch(`/api/sessions/${this.session.id}/input`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authClient.getAuthHeader(),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        logger.error('failed to send input to session', { status: response.status });

        // Check if session has exited (400 response)
        if (response.status === 400) {
          // Update session status to exited
          if (this.session) {
            this.session.status = 'exited';
            // Trigger UI update through callbacks
            if (this.callbacks) {
              this.callbacks.requestUpdate();
            }
          }
        }
      }
    } catch (error) {
      logger.error('error sending input', error);
    }
  }

  private async sendInput(inputText: string): Promise<void> {
    try {
      // Determine if we should send as key or text
      const body = [
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
      ].includes(inputText)
        ? { key: inputText }
        : { text: inputText };

      if (!this.session) return;

      const response = await fetch(`/api/sessions/${this.session.id}/input`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authClient.getAuthHeader(),
        },
        body: JSON.stringify(body),
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
          logger.error('failed to send input to session', { status: response.status });
        }
      }
    } catch (error) {
      logger.error('error sending input', error);
    }
  }

  isKeyboardShortcut(e: KeyboardEvent): boolean {
    // Check if we're typing in an input field
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT'
    ) {
      // Allow normal input in form fields
      return false;
    }

    // Allow important browser shortcuts to pass through
    const isMacOS = navigator.platform.toLowerCase().includes('mac');

    // Allow F12 and Ctrl+Shift+I (DevTools)
    if (
      e.key === 'F12' ||
      (!isMacOS && e.ctrlKey && e.shiftKey && e.key === 'I') ||
      (isMacOS && e.metaKey && e.altKey && e.key === 'I')
    ) {
      return true;
    }

    // Allow Ctrl+A (select all), Ctrl+F (find), Ctrl+R (refresh), Ctrl+C/V (copy/paste), etc.
    if (
      !isMacOS &&
      e.ctrlKey &&
      !e.shiftKey &&
      ['a', 'f', 'r', 'l', 't', 'w', 'n', 'c', 'v'].includes(e.key.toLowerCase())
    ) {
      return true;
    }

    // Allow Cmd+A, Cmd+F, Cmd+R, Cmd+C/V (copy/paste), etc. on macOS
    if (
      isMacOS &&
      e.metaKey &&
      !e.shiftKey &&
      !e.altKey &&
      ['a', 'f', 'r', 'l', 't', 'w', 'n', 'c', 'v'].includes(e.key.toLowerCase())
    ) {
      return true;
    }

    // Allow Alt+Tab, Cmd+Tab (window switching)
    if ((e.altKey || e.metaKey) && e.key === 'Tab') {
      return true;
    }

    return false;
  }

  cleanup(): void {
    // Clear references to prevent memory leaks
    this.session = null;
    this.callbacks = null;
  }
}
