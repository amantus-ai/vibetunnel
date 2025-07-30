/**
 * Desktop IME Input Component
 *
 * A reusable component for handling Input Method Editor (IME) composition
 * on desktop browsers, particularly for CJK (Chinese, Japanese, Korean) text input.
 *
 * This component creates a hidden input element that captures IME composition
 * events and forwards the completed text to a callback function. It's designed
 * specifically for desktop environments where native IME handling is needed.
 */

import { Z_INDEX } from '../utils/constants.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ime-input');

export interface DesktopIMEInputOptions {
  /** Container element to append the input to */
  container: HTMLElement;
  /** Callback when text is ready to be sent (after composition ends or regular input) */
  onTextInput: (text: string) => void;
  /** Callback when special keys are pressed (Enter, Backspace, etc.) */
  onSpecialKey?: (key: string) => void;
  /** Optional callback to get cursor position for positioning the input */
  getCursorInfo?: () => { x: number; y: number } | null;
  /** Whether to auto-focus the input on creation */
  autoFocus?: boolean;
  /** Additional class name for the input element */
  className?: string;
  /** Z-index for the input element */
  zIndex?: number;
}

export class DesktopIMEInput {
  private input: HTMLInputElement;
  private isComposing = false;
  private options: DesktopIMEInputOptions;
  private documentClickHandler: ((e: Event) => void) | null = null;
  private globalPasteHandler: ((e: Event) => void) | null = null;
  private focusRetentionInterval: number | null = null;

  constructor(options: DesktopIMEInputOptions) {
    this.options = options;
    this.input = this.createInput();
    this.setupEventListeners();

    if (options.autoFocus) {
      this.focus();
    }
  }

  private createInput(): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.style.position = 'absolute';
    input.style.top = '0px';
    input.style.left = '0px';
    input.style.transform = 'none';
    input.style.width = '1px';
    input.style.height = '1px';
    input.style.fontSize = '16px';
    input.style.padding = '0';
    input.style.border = 'none';
    input.style.borderRadius = '0';
    input.style.backgroundColor = 'transparent';
    input.style.color = 'transparent';
    input.style.zIndex = String(this.options.zIndex || Z_INDEX.IME_INPUT);
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    input.placeholder = 'CJK Input';
    input.autocapitalize = 'off';
    input.setAttribute('autocorrect', 'off');
    input.autocomplete = 'off';
    input.spellcheck = false;

    if (this.options.className) {
      input.className = this.options.className;
    }

    this.options.container.appendChild(input);
    return input;
  }

  private setupEventListeners(): void {
    // IME composition events
    this.input.addEventListener('compositionstart', this.handleCompositionStart);
    this.input.addEventListener('compositionupdate', this.handleCompositionUpdate);
    this.input.addEventListener('compositionend', this.handleCompositionEnd);
    this.input.addEventListener('input', this.handleInput);
    this.input.addEventListener('keydown', this.handleKeydown);
    this.input.addEventListener('paste', this.handlePaste);

    // Focus tracking
    this.input.addEventListener('focus', this.handleFocus);
    this.input.addEventListener('blur', this.handleBlur);

    // Document click handler for auto-focus
    this.documentClickHandler = (e: Event) => {
      const target = e.target as HTMLElement;
      if (this.options.container.contains(target) || target === this.options.container) {
        this.focus();
      }
    };
    document.addEventListener('click', this.documentClickHandler);

    // Global paste handler for when IME input doesn't have focus
    this.globalPasteHandler = (e: Event) => {
      const pasteEvent = e as ClipboardEvent;
      const target = e.target as HTMLElement;

      // Skip if paste is already handled by the IME input
      if (target === this.input) {
        return;
      }

      // Only handle paste if we're in the session area
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.contentEditable === 'true' ||
        target.closest?.('.monaco-editor') ||
        target.closest?.('[data-keybinding-context]')
      ) {
        return;
      }

      const pastedText = pasteEvent.clipboardData?.getData('text');
      if (pastedText) {
        this.options.onTextInput(pastedText);
        pasteEvent.preventDefault();
      }
    };
    document.addEventListener('paste', this.globalPasteHandler);
  }

  private handleCompositionStart = () => {
    this.isComposing = true;
    document.body.setAttribute('data-ime-composing', 'true');
    this.updatePosition();
    logger.log('IME composition started');
  };

  private handleCompositionUpdate = (e: CompositionEvent) => {
    logger.log('IME composition update:', e.data);
  };

  private handleCompositionEnd = (e: CompositionEvent) => {
    this.isComposing = false;
    document.body.removeAttribute('data-ime-composing');

    const finalText = e.data;
    if (finalText) {
      this.options.onTextInput(finalText);
    }

    this.input.value = '';
    logger.log('IME composition ended:', finalText);
  };

  private handleInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const text = input.value;

    // Skip if composition is active
    if (this.isComposing) {
      return;
    }

    // Handle regular typing (non-IME)
    if (text) {
      this.options.onTextInput(text);
      input.value = '';
    }
  };

  private handleKeydown = (e: KeyboardEvent) => {
    // Handle Cmd+V / Ctrl+V - let browser handle paste naturally
    if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
      return;
    }

    // During IME composition, let the browser handle ALL keys
    if (this.isComposing) {
      return;
    }

    // Handle special keys when not composing
    if (this.options.onSpecialKey) {
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          if (this.input.value.trim()) {
            this.options.onTextInput(this.input.value);
            this.input.value = '';
          }
          this.options.onSpecialKey('enter');
          break;
        case 'Backspace':
          if (!this.input.value) {
            e.preventDefault();
            this.options.onSpecialKey('backspace');
          }
          break;
        case 'Tab':
          e.preventDefault();
          this.options.onSpecialKey(e.shiftKey ? 'shift_tab' : 'tab');
          break;
        case 'Escape':
          e.preventDefault();
          this.options.onSpecialKey('escape');
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.options.onSpecialKey('arrow_up');
          break;
        case 'ArrowDown':
          e.preventDefault();
          this.options.onSpecialKey('arrow_down');
          break;
        case 'ArrowLeft':
          if (!this.input.value) {
            e.preventDefault();
            this.options.onSpecialKey('arrow_left');
          }
          break;
        case 'ArrowRight':
          if (!this.input.value) {
            e.preventDefault();
            this.options.onSpecialKey('arrow_right');
          }
          break;
        case 'Delete':
          e.preventDefault();
          e.stopPropagation();
          this.options.onSpecialKey('delete');
          break;
      }
    }
  };

  private handlePaste = (e: ClipboardEvent) => {
    const pastedText = e.clipboardData?.getData('text');
    if (pastedText) {
      this.options.onTextInput(pastedText);
      this.input.value = '';
      e.preventDefault();
    }
  };

  private handleFocus = () => {
    document.body.setAttribute('data-ime-input-focused', 'true');
    logger.log('IME input focused');

    // Start focus retention to prevent losing focus
    this.startFocusRetention();
  };

  private handleBlur = () => {
    logger.log('IME input blurred');

    // Don't immediately remove focus state - let focus retention handle it
    // This prevents rapid focus/blur cycles from breaking the state
    setTimeout(() => {
      if (document.activeElement !== this.input) {
        document.body.removeAttribute('data-ime-input-focused');
        this.stopFocusRetention();
      }
    }, 50);
  };

  private updatePosition(): void {
    if (!this.options.getCursorInfo) {
      // Fallback to safe positioning when no cursor info provider
      this.input.style.left = '10px';
      this.input.style.top = '10px';
      return;
    }

    const cursorInfo = this.options.getCursorInfo();
    if (!cursorInfo) {
      // Fallback to safe positioning when cursor info unavailable
      this.input.style.left = '10px';
      this.input.style.top = '10px';
      return;
    }

    // Position IME input at cursor location
    this.input.style.left = `${Math.max(10, cursorInfo.x)}px`;
    this.input.style.top = `${Math.max(10, cursorInfo.y)}px`;
  }

  focus(): void {
    this.updatePosition();
    requestAnimationFrame(() => {
      this.input.focus();
      // If focus didn't work, try once more
      if (document.activeElement !== this.input) {
        requestAnimationFrame(() => {
          if (document.activeElement !== this.input) {
            this.input.focus();
          }
        });
      }
    });
  }

  blur(): void {
    this.input.blur();
  }

  isFocused(): boolean {
    return document.activeElement === this.input;
  }

  isComposingText(): boolean {
    return this.isComposing;
  }

  private startFocusRetention(): void {
    // Skip focus retention in test environment to avoid infinite loops with fake timers
    if (
      (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') ||
      // Additional check for test environment (vitest/jest globals)
      typeof (globalThis as Record<string, unknown>).beforeEach !== 'undefined'
    ) {
      return;
    }

    if (this.focusRetentionInterval) {
      clearInterval(this.focusRetentionInterval);
    }

    this.focusRetentionInterval = setInterval(() => {
      if (document.activeElement !== this.input) {
        this.input.focus();
      }
    }, 100) as unknown as number;
  }

  private stopFocusRetention(): void {
    if (this.focusRetentionInterval) {
      clearInterval(this.focusRetentionInterval);
      this.focusRetentionInterval = null;
    }
  }

  stopFocusRetentionForTesting(): void {
    this.stopFocusRetention();
  }

  cleanup(): void {
    // Stop focus retention
    this.stopFocusRetention();

    // Remove event listeners
    this.input.removeEventListener('compositionstart', this.handleCompositionStart);
    this.input.removeEventListener('compositionupdate', this.handleCompositionUpdate);
    this.input.removeEventListener('compositionend', this.handleCompositionEnd);
    this.input.removeEventListener('input', this.handleInput);
    this.input.removeEventListener('keydown', this.handleKeydown);
    this.input.removeEventListener('paste', this.handlePaste);
    this.input.removeEventListener('focus', this.handleFocus);
    this.input.removeEventListener('blur', this.handleBlur);

    if (this.documentClickHandler) {
      document.removeEventListener('click', this.documentClickHandler);
      this.documentClickHandler = null;
    }

    if (this.globalPasteHandler) {
      document.removeEventListener('paste', this.globalPasteHandler);
      this.globalPasteHandler = null;
    }

    // Clean up attributes
    document.body.removeAttribute('data-ime-input-focused');
    document.body.removeAttribute('data-ime-composing');

    // Remove input element
    this.input.remove();

    logger.log('IME input cleaned up');
  }
}
