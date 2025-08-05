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
import { IME_VERTICAL_OFFSET_PX, TERMINAL_FONT_FAMILY } from '../utils/terminal-constants.js';

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
  /** Optional callback to get font size from terminal */
  getFontSize?: () => number;
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
    // Use a more standard IME input approach - always visible but positioned
    input.style.position = 'absolute';
    input.style.top = '-9999px'; // Start off-screen
    input.style.left = '-9999px';
    input.style.transform = 'none';
    input.style.width = '200px'; // Fixed width for better IME compatibility
    input.style.height = '24px';
    // Use terminal font size if available, otherwise default to 14px
    const fontSize = this.options.getFontSize?.() || 14;
    input.style.fontSize = `${fontSize}px`;
    input.style.padding = '2px 4px';
    input.style.border = 'none';
    input.style.borderRadius = '0';
    input.style.backgroundColor = 'transparent';
    input.style.color = '#e2e8f0';
    input.style.zIndex = String(this.options.zIndex || Z_INDEX.IME_INPUT);
    input.style.opacity = '1';
    input.style.visibility = 'visible';
    input.style.pointerEvents = 'auto';
    input.style.fontFamily = TERMINAL_FONT_FAMILY;
    input.style.outline = 'none';
    input.style.caretColor = 'transparent'; // Hide the blinking cursor
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
    // Keep input visible during composition
    this.showInput();
    this.updatePosition();
    logger.log('IME composition started');
  };

  private handleCompositionUpdate = (e: CompositionEvent) => {
    logger.log('IME composition update:', e.data);
    // Update position during composition as well
    this.updatePosition();
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

    // Hide input after composition if not focused
    setTimeout(() => {
      if (document.activeElement !== this.input) {
        this.hideInput();
      }
      this.updatePosition();
    }, 100);
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
      // Hide input after sending text if not focused
      setTimeout(() => {
        if (document.activeElement !== this.input) {
          this.hideInput();
        }
      }, 100);
    }
  };

  private handleKeydown = (e: KeyboardEvent) => {
    // Handle Cmd+V / Ctrl+V - let browser handle paste naturally
    if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
      return;
    }

    // During IME composition, let the browser handle ALL keys including Enter
    if (this.isComposing) {
      return;
    }

    // Handle special keys when not composing
    if (this.options.onSpecialKey) {
      switch (e.key) {
        case 'Enter':
          if (this.input.value.trim()) {
            // Send the text content and clear input
            e.preventDefault();
            this.options.onTextInput(this.input.value);
            this.input.value = '';
          } else {
            // Send Enter key to terminal only if input is empty
            e.preventDefault();
            this.options.onSpecialKey('enter');
          }
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

    // Show the input when focused
    this.showInput();

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
        // Hide the input when not focused and not composing
        if (!this.isComposing) {
          this.hideInput();
        }
      }
    }, 50);
  };

  private showInput(): void {
    // Position will be updated by updatePosition()
    logger.log('IME input shown');
  }

  private hideInput(): void {
    // Move input off-screen instead of hiding
    this.input.style.top = '-9999px';
    this.input.style.left = '-9999px';
    logger.log('IME input hidden');
  }

  private updatePosition(): void {
    if (!this.options.getCursorInfo) {
      // Fallback to safe positioning when no cursor info provider
      logger.warn('No getCursorInfo callback provided, using fallback position');
      this.input.style.left = '10px';
      this.input.style.top = '10px';
      return;
    }

    const cursorInfo = this.options.getCursorInfo();
    if (!cursorInfo) {
      // Fallback to safe positioning when cursor info unavailable
      logger.warn('getCursorInfo returned null, using fallback position');
      this.input.style.left = '10px';
      this.input.style.top = '10px';
      return;
    }

    // Position IME input at cursor location with upward adjustment for better alignment
    const x = Math.max(10, cursorInfo.x);
    const y = Math.max(10, cursorInfo.y - IME_VERTICAL_OFFSET_PX);

    logger.log(`Positioning CJK input at x=${x}, y=${y}`);
    this.input.style.left = `${x}px`;
    this.input.style.top = `${y}px`;
  }

  focus(): void {
    // Update position first to bring input into view
    this.updatePosition();
    this.showInput();

    // Use immediate focus
    this.input.focus();

    // Verify focus worked
    requestAnimationFrame(() => {
      if (document.activeElement !== this.input) {
        requestAnimationFrame(() => {
          if (document.activeElement !== this.input) {
            this.input.focus();
          }
        });
      }
    });
  }

  /**
   * Update the IME input position based on cursor location
   * Can be called externally when cursor moves
   */
  refreshPosition(): void {
    this.updatePosition();
  }

  /**
   * Update the font size of the IME input
   * Should be called when terminal font size changes
   */
  updateFontSize(): void {
    const fontSize = this.options.getFontSize?.() || 14;
    this.input.style.fontSize = `${fontSize}px`;
    logger.log(`Updated IME input font size to ${fontSize}px`);
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

    // Don't use aggressive focus retention - it interferes with IME
    // Just ensure focus stays during composition
    if (this.focusRetentionInterval) {
      clearInterval(this.focusRetentionInterval);
    }
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
