/**
 * Direct Keyboard Input Manager
 *
 * Manages hidden input element and direct keyboard input for mobile devices.
 * Handles focus management, input events, quick key interactions, and IME composition.
 *
 * ## IME Support for Japanese/CJK Input
 *
 * This manager now includes full support for Input Method Editor (IME) composition,
 * which is essential for Japanese, Chinese, and Korean text input on mobile devices.
 *
 * **How IME Works:**
 * 1. User types "konnichiwa" on Japanese keyboard
 * 2. Browser shows composition UI: "こんにちは" (intermediate characters)
 * 3. User selects final text from candidates
 * 4. Browser fires `compositionend` with final text: "こんにちは"
 *
 * **Bug Fixed (GitHub #99):**
 * Previously, intermediate composition characters were sent to terminal during typing,
 * causing duplicated/garbled Japanese text. Now we properly wait for composition
 * completion before sending any text to the terminal.
 *
 * **Implementation:**
 * - `compositionstart`: Sets isComposing=true, prevents input events from sending text
 * - `compositionupdate`: Tracks intermediate composition (for logging/debugging)
 * - `compositionend`: Sends only the final composed text to terminal
 * - `input`: Skipped entirely during composition, normal handling otherwise
 */

import { Z_INDEX } from '../../utils/constants.js';
import { createLogger } from '../../utils/logger.js';
import type { InputManager } from './input-manager.js';

const logger = createLogger('direct-keyboard-manager');

export interface DirectKeyboardCallbacks {
  getShowMobileInput(): boolean;
  getShowCtrlAlpha(): boolean;
  getDisableFocusManagement(): boolean;
  getVisualViewportHandler(): (() => void) | null;
  getKeyboardHeight(): number;
  setKeyboardHeight(height: number): void;
  updateShowQuickKeys(value: boolean): void;
  toggleMobileInput(): void;
  clearMobileInputText(): void;
  toggleCtrlAlpha(): void;
  clearCtrlSequence(): void;
}

export class DirectKeyboardManager {
  private hiddenInput: HTMLInputElement | null = null;
  private focusRetentionInterval: number | null = null;
  private inputManager: InputManager | null = null;
  private sessionViewElement: HTMLElement | null = null;
  private callbacks: DirectKeyboardCallbacks | null = null;
  private showQuickKeys = false;
  private keyboardMode = false; // Track whether we're in keyboard mode
  private keyboardActivationTimeout: number | null = null;
  private captureClickHandler: ((e: Event) => void) | null = null;
  private globalPasteHandler: ((e: Event) => void) | null = null;

  // IME composition state tracking for Japanese/CJK input
  private isComposing = false;

  // Instance management
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: Used in constructor
  private instanceId: string;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: Used for focus state management
  private hiddenInputFocused = false;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: Used for keyboard mode timing
  private keyboardModeTimestamp = 0;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: Used for IME composition
  private compositionBuffer = '';

  constructor(instanceId: string) {
    this.instanceId = instanceId;

    // Add global paste listener for environments where Clipboard API doesn't work
    this.setupGlobalPasteListener();
  }

  setInputManager(inputManager: InputManager): void {
    this.inputManager = inputManager;
  }

  setSessionViewElement(element: HTMLElement): void {
    this.sessionViewElement = element;
  }

  setCallbacks(callbacks: DirectKeyboardCallbacks): void {
    this.callbacks = callbacks;
  }

  getShowQuickKeys(): boolean {
    return this.showQuickKeys;
  }

  setShowQuickKeys(value: boolean): void {
    this.showQuickKeys = value;
    if (!value) {
      // When hiding quick keys, also clear focus states
      this.hiddenInputFocused = false;

      // Clear focus retention interval
      if (this.focusRetentionInterval) {
        clearInterval(this.focusRetentionInterval);
        this.focusRetentionInterval = null;
      }

      // Blur the hidden input but don't exit keyboard mode immediately
      // Let the blur handler deal with exiting keyboard mode after checks
      if (this.hiddenInput) {
        this.hiddenInput.blur();
      }

      logger.log('Quick keys force hidden by external trigger');
    }
  }

  focusHiddenInput(): void {
    logger.log('Entering keyboard mode');
    // Enter keyboard mode
    this.keyboardMode = true;
    this.keyboardModeTimestamp = Date.now();
    this.updateHiddenInputPosition();

    // Add capture phase click handler to prevent any clicks from stealing focus
    if (!this.captureClickHandler) {
      this.captureClickHandler = (e: Event) => {
        if (this.keyboardMode) {
          const target = e.target as HTMLElement;

          // Allow clicks on:
          // 1. Quick keys container (Done button, etc)
          // 2. Session header (back button, sidebar toggle, etc)
          // 3. App header
          // 4. Settings/notification buttons
          // 5. Any modal overlays
          // 6. Sidebar
          // 7. Any buttons or interactive elements outside terminal
          if (
            target.closest('.terminal-quick-keys-container') ||
            target.closest('session-header') ||
            target.closest('app-header') ||
            target.closest('.modal-backdrop') ||
            target.closest('.modal-content') ||
            target.closest('.sidebar') ||
            target.closest('unified-settings') ||
            target.closest('notification-status') ||
            target.closest('button') ||
            target.closest('a') ||
            target.closest('[role="button"]') ||
            target.closest('.settings-button') ||
            target.closest('.notification-button')
          ) {
            return;
          }

          // Only prevent clicks on the terminal area itself
          // This keeps focus on the hidden input when tapping the terminal
          if (target.closest('#terminal-container') || target.closest('vibe-terminal')) {
            if (this.hiddenInput) {
              this.hiddenInput.focus();
            }
          }
        }
      };
      // Use capture phase to intercept clicks before they reach other elements
      document.addEventListener('click', this.captureClickHandler, true);
      document.addEventListener('pointerdown', this.captureClickHandler, true);
    }

    // Start focus retention immediately
    if (this.focusRetentionInterval) {
      clearInterval(this.focusRetentionInterval);
    }
    this.startFocusRetention();

    // Ensure input is ready and focus it synchronously
    this.ensureHiddenInputVisible();
  }

  ensureHiddenInputVisible(): void {
    if (!this.hiddenInput) {
      this.createHiddenInput();
    }

    // Show quick keys immediately when entering keyboard mode
    // Don't wait for keyboard to appear - this provides immediate visual feedback
    if (this.keyboardMode && !this.showQuickKeys) {
      this.showQuickKeys = true;
      if (this.callbacks) {
        this.callbacks.updateShowQuickKeys(true);
        logger.log('Showing quick keys immediately in keyboard mode');
      }
    }

    // Now that we're in keyboard mode, focus the input synchronously
    if (this.hiddenInput && this.keyboardMode) {
      // Make sure input is visible and ready
      this.hiddenInput.style.display = 'block';
      this.hiddenInput.style.visibility = 'visible';

      // Focus synchronously - critical for iOS Safari
      this.hiddenInput.focus();

      // Set a dummy value and select it to help trigger iOS keyboard
      // This helps iOS recognize that we want to show the keyboard
      this.hiddenInput.value = ' ';
      this.hiddenInput.setSelectionRange(0, 1);

      // Clear the dummy value after a short delay
      setTimeout(() => {
        if (this.hiddenInput) {
          this.hiddenInput.value = '';
        }
      }, 50);

      logger.log('Focused hidden input with dummy value trick');
    }
  }

  private createHiddenInput(): void {
    this.hiddenInput = document.createElement('input');
    this.hiddenInput.type = 'text';
    this.hiddenInput.style.position = 'absolute';
    this.hiddenInput.style.opacity = '0.01'; // iOS needs non-zero opacity
    this.hiddenInput.style.fontSize = '16px'; // Prevent zoom on iOS
    this.hiddenInput.style.border = 'none';
    this.hiddenInput.style.outline = 'none';
    this.hiddenInput.style.background = 'transparent';
    this.hiddenInput.style.color = 'transparent';
    this.hiddenInput.style.caretColor = 'transparent';
    this.hiddenInput.style.cursor = 'default';
    this.hiddenInput.style.pointerEvents = 'none'; // Start with pointer events disabled
    this.hiddenInput.style.webkitUserSelect = 'text'; // iOS specific
    this.hiddenInput.autocapitalize = 'none'; // More explicit than 'off'
    this.hiddenInput.autocomplete = 'off';
    this.hiddenInput.setAttribute('autocorrect', 'off');
    this.hiddenInput.setAttribute('spellcheck', 'false');
    this.hiddenInput.setAttribute('data-autocorrect', 'off');
    this.hiddenInput.setAttribute('data-gramm', 'false'); // Disable Grammarly
    this.hiddenInput.setAttribute('data-ms-editor', 'false'); // Disable Microsoft Editor
    this.hiddenInput.setAttribute('data-smartpunctuation', 'false'); // Disable smart quotes/dashes
    this.hiddenInput.setAttribute('data-form-type', 'other'); // Hint this isn't a form field
    this.hiddenInput.setAttribute('inputmode', 'text'); // Allow keyboard but disable optimizations
    this.hiddenInput.setAttribute('enterkeyhint', 'done'); // Prevent iOS enter key behavior
    this.hiddenInput.setAttribute('aria-hidden', 'true');

    // Set initial position based on mode
    this.updateHiddenInputPosition();

    // Handle IME composition events for Japanese/CJK input
    this.hiddenInput.addEventListener('compositionstart', () => {
      this.isComposing = true;
      this.compositionBuffer = '';
    });

    this.hiddenInput.addEventListener('compositionupdate', (e) => {
      const compositionEvent = e as CompositionEvent;
      this.compositionBuffer = compositionEvent.data || '';
    });

    this.hiddenInput.addEventListener('compositionend', (e) => {
      const compositionEvent = e as CompositionEvent;
      this.isComposing = false;

      // Get the final composed text
      const finalText = compositionEvent.data || this.hiddenInput?.value || '';

      if (finalText) {
        // Don't send input to terminal if mobile input overlay or Ctrl overlay is visible
        const showMobileInput = this.callbacks?.getShowMobileInput() ?? false;
        const showCtrlAlpha = this.callbacks?.getShowCtrlAlpha() ?? false;
        if (!showMobileInput && !showCtrlAlpha && this.inputManager) {
          // Send the completed composition to terminal
          this.inputManager.sendInputText(finalText);
        }
      }

      // Clear the input and composition buffer
      if (this.hiddenInput) {
        this.hiddenInput.value = '';
      }
      this.compositionBuffer = '';
    });

    // Handle input events (non-composition)
    this.hiddenInput.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;

      // Skip processing if we're in the middle of IME composition
      if (this.isComposing) {
        return;
      }

      if (input.value) {
        // Don't send input to terminal if mobile input overlay or Ctrl overlay is visible
        const showMobileInput = this.callbacks?.getShowMobileInput() ?? false;
        const showCtrlAlpha = this.callbacks?.getShowCtrlAlpha() ?? false;
        if (!showMobileInput && !showCtrlAlpha && this.inputManager) {
          // Send each character to terminal (only for non-IME input)
          this.inputManager.sendInputText(input.value);
        }
        // Always clear the input to prevent buffer buildup
        input.value = '';
      }
    });

    // Handle special keys
    this.hiddenInput.addEventListener('keydown', (e) => {
      // Don't process special keys if mobile input overlay or Ctrl overlay is visible
      const showMobileInput = this.callbacks?.getShowMobileInput() ?? false;
      const showCtrlAlpha = this.callbacks?.getShowCtrlAlpha() ?? false;
      if (showMobileInput || showCtrlAlpha) {
        return;
      }

      // Prevent default for all keys to stop browser shortcuts
      if (['Enter', 'Backspace', 'Tab', 'Escape'].includes(e.key)) {
        e.preventDefault();
      }

      if (e.key === 'Enter' && this.inputManager) {
        this.inputManager.sendInput('enter');
      } else if (e.key === 'Backspace' && this.inputManager) {
        // Always send backspace to terminal
        this.inputManager.sendInput('backspace');
      } else if (e.key === 'Tab' && this.inputManager) {
        this.inputManager.sendInput(e.shiftKey ? 'shift_tab' : 'tab');
      } else if (e.key === 'Escape' && this.inputManager) {
        this.inputManager.sendInput('escape');
      }
    });

    // Handle focus/blur for quick keys visibility
    this.hiddenInput.addEventListener('focus', () => {
      this.hiddenInputFocused = true;
      logger.log(`Hidden input focused. Keyboard mode: ${this.keyboardMode}`);

      // Enable pointer events while focused
      if (this.hiddenInput && this.keyboardMode) {
        this.hiddenInput.style.pointerEvents = 'auto';
      }

      // If we're in keyboard mode, show quick keys immediately
      if (this.keyboardMode) {
        this.showQuickKeys = true;
        if (this.callbacks) {
          this.callbacks.updateShowQuickKeys(true);
          logger.log('Showing quick keys due to keyboard mode');
        }

        // iOS specific: Set selection to trigger keyboard
        if (this.hiddenInput) {
          this.hiddenInput.setSelectionRange(0, 0);
        }
      } else {
        // Only show quick keys if keyboard is actually visible
        const keyboardHeight = this.callbacks?.getKeyboardHeight() ?? 0;
        if (keyboardHeight > 50) {
          this.showQuickKeys = true;
          if (this.callbacks) {
            this.callbacks.updateShowQuickKeys(true);
          }
        }
      }

      // Trigger initial keyboard height calculation
      const visualViewportHandler = this.callbacks?.getVisualViewportHandler();
      if (visualViewportHandler) {
        visualViewportHandler();
      }

      // Start focus retention if not already running
      if (!this.focusRetentionInterval) {
        this.startFocusRetention();
      }
    });

    this.hiddenInput.addEventListener('blur', (e) => {
      const _event = e as FocusEvent;

      logger.log(`Hidden input blurred. Keyboard mode: ${this.keyboardMode}`);
      logger.log(
        `Active element: ${document.activeElement?.tagName}, class: ${document.activeElement?.className}`
      );

      // If we're in keyboard mode, ALWAYS try to maintain focus
      // Only the Done button should exit keyboard mode
      if (this.keyboardMode) {
        logger.log('In keyboard mode - maintaining focus');

        // Immediately try to refocus
        setTimeout(() => {
          if (
            this.keyboardMode &&
            this.hiddenInput &&
            document.activeElement !== this.hiddenInput
          ) {
            logger.log('Refocusing hidden input to maintain keyboard');
            this.hiddenInput.focus();
          }
        }, 0);

        // Don't exit keyboard mode or hide quick keys
        return;
      }

      // Only handle blur normally when NOT in keyboard mode
      const disableFocusManagement = this.callbacks?.getDisableFocusManagement() ?? false;
      if (!disableFocusManagement && this.showQuickKeys && this.hiddenInput) {
        // Check if focus went somewhere legitimate
        setTimeout(() => {
          const activeElement = document.activeElement;
          const isWithinComponent = this.sessionViewElement?.contains(activeElement) ?? false;

          if (!isWithinComponent && activeElement && activeElement !== document.body) {
            // Focus went somewhere outside our component
            this.hiddenInputFocused = false;
            this.showQuickKeys = false;
            if (this.callbacks) {
              this.callbacks.updateShowQuickKeys(false);
            }
            logger.log('Focus left component, hiding quick keys');

            // Clear focus retention interval
            if (this.focusRetentionInterval) {
              clearInterval(this.focusRetentionInterval);
              this.focusRetentionInterval = null;
            }
          }
        }, 100);
      } else {
        // Not in keyboard mode and not showing quick keys
        this.hiddenInputFocused = false;
      }
    });

    // Add to the terminal container
    const terminalContainer = this.sessionViewElement?.querySelector('#terminal-container');
    if (terminalContainer) {
      terminalContainer.appendChild(this.hiddenInput);
    }
  }

  handleQuickKeyPress = async (
    key: string,
    isModifier?: boolean,
    isSpecial?: boolean,
    _isToggle?: boolean,
    _pasteText?: string
  ): Promise<void> => {
    if (!this.inputManager) {
      logger.error('No input manager found');
      return;
    }
    if (isSpecial && key === 'Done') {
      // Dismiss the keyboard
      logger.log('Done button pressed - dismissing keyboard');
      this.dismissKeyboard();
      return;
    } else if (isModifier && key === 'Control') {
      // Just send Ctrl modifier - don't show the overlay
      // This allows using Ctrl as a modifier with physical keyboard
      return;
    } else if (key === 'CtrlFull') {
      // Toggle the full Ctrl+Alpha overlay
      if (this.callbacks) {
        this.callbacks.toggleCtrlAlpha();
      }

      const showCtrlAlpha = this.callbacks?.getShowCtrlAlpha() ?? false;
      if (showCtrlAlpha) {
        // Stop focus retention when showing Ctrl overlay
        if (this.focusRetentionInterval) {
          clearInterval(this.focusRetentionInterval);
          this.focusRetentionInterval = null;
        }

        // Blur the hidden input to prevent it from capturing input
        if (this.hiddenInput) {
          this.hiddenInput.blur();
        }
      } else {
        // Clear the Ctrl sequence when closing
        if (this.callbacks) {
          this.callbacks.clearCtrlSequence();
        }

        // Restart focus retention when closing Ctrl overlay
        const disableFocusManagement = this.callbacks?.getDisableFocusManagement() ?? false;
        if (!disableFocusManagement && this.hiddenInput && this.showQuickKeys) {
          this.startFocusRetention();
          this.delayedRefocusHiddenInput();
        }
      }
      return;
    } else if (key === 'Paste') {
      // Handle Paste key - following iOS Safari best practices
      logger.log('Paste button pressed - attempting clipboard read');

      // Log environment details for debugging
      logger.log('Clipboard context:', {
        hasClipboard: !!navigator.clipboard,
        hasReadText: !!navigator.clipboard?.readText,
        isSecureContext: window.isSecureContext,
        protocol: window.location.protocol,
        userAgent: navigator.userAgent.includes('Safari') ? 'Safari' : 'Other',
      });

      // Check if we're in a secure context (HTTPS/localhost/PWA)
      if (window.isSecureContext && navigator.clipboard && navigator.clipboard.readText) {
        try {
          logger.log('Secure context detected - trying modern clipboard API...');
          const text = await navigator.clipboard.readText();
          logger.log('Clipboard read successful, text length:', text?.length || 0);

          if (text && this.inputManager) {
            logger.log('Sending clipboard text to terminal');
            this.inputManager.sendInputText(text);
            return; // Success - exit early
          } else if (!text) {
            logger.warn('Clipboard is empty or contains no text');
            return;
          }
        } catch (err) {
          const error = err as Error;
          logger.warn('Clipboard API failed despite secure context:', {
            name: error?.name,
            message: error?.message,
          });
          // Continue to fallback
        }
      } else {
        logger.log(
          'Not in secure context (HTTP) - clipboard API unavailable, using textarea fallback'
        );
      }

      // Fallback: Use existing hidden input with paste event
      logger.log('Using iOS native paste fallback with existing hidden input');
      this.triggerNativePasteWithHiddenInput();
    } else if (key === 'Ctrl+A') {
      // Send Ctrl+A (start of line)
      this.inputManager.sendControlSequence('\x01');
    } else if (key === 'Ctrl+C') {
      // Send Ctrl+C (interrupt signal)
      this.inputManager.sendControlSequence('\x03');
    } else if (key === 'Ctrl+D') {
      // Send Ctrl+D (EOF)
      this.inputManager.sendControlSequence('\x04');
    } else if (key === 'Ctrl+E') {
      // Send Ctrl+E (end of line)
      this.inputManager.sendControlSequence('\x05');
    } else if (key === 'Ctrl+K') {
      // Send Ctrl+K (kill to end of line)
      this.inputManager.sendControlSequence('\x0b');
    } else if (key === 'Ctrl+L') {
      // Send Ctrl+L (clear screen)
      this.inputManager.sendControlSequence('\x0c');
    } else if (key === 'Ctrl+R') {
      // Send Ctrl+R (reverse search)
      this.inputManager.sendControlSequence('\x12');
    } else if (key === 'Ctrl+U') {
      // Send Ctrl+U (clear line)
      this.inputManager.sendControlSequence('\x15');
    } else if (key === 'Ctrl+W') {
      // Send Ctrl+W (delete word)
      this.inputManager.sendControlSequence('\x17');
    } else if (key === 'Ctrl+Z') {
      // Send Ctrl+Z (suspend signal)
      this.inputManager.sendControlSequence('\x1a');
    } else if (key === 'Option') {
      // Send ESC prefix for Option/Alt key
      this.inputManager.sendControlSequence('\x1b');
    } else if (key === 'Command') {
      // Command key doesn't have a direct terminal equivalent
      // Could potentially show a message or ignore
      return;
    } else if (key === 'Delete') {
      // Send delete key
      this.inputManager.sendInput('delete');
    } else if (key.startsWith('F')) {
      // Handle function keys F1-F12
      const fNum = Number.parseInt(key.substring(1));
      if (fNum >= 1 && fNum <= 12) {
        this.inputManager.sendInput(`f${fNum}`);
      }
    } else {
      // Map key names to proper values
      let keyToSend = key;
      if (key === 'Tab') {
        keyToSend = 'tab';
      } else if (key === 'Escape') {
        keyToSend = 'escape';
      } else if (key === 'ArrowUp') {
        keyToSend = 'arrow_up';
      } else if (key === 'ArrowDown') {
        keyToSend = 'arrow_down';
      } else if (key === 'ArrowLeft') {
        keyToSend = 'arrow_left';
      } else if (key === 'ArrowRight') {
        keyToSend = 'arrow_right';
      } else if (key === 'PageUp') {
        keyToSend = 'page_up';
      } else if (key === 'PageDown') {
        keyToSend = 'page_down';
      } else if (key === 'Home') {
        keyToSend = 'home';
      } else if (key === 'End') {
        keyToSend = 'end';
      }

      // Send the key to terminal
      this.inputManager.sendInput(keyToSend.toLowerCase());
    }

    // Always keep focus on hidden input after any key press (except Done)
    // Use requestAnimationFrame to ensure DOM has updated
    requestAnimationFrame(() => {
      const disableFocusManagement = this.callbacks?.getDisableFocusManagement() ?? false;
      if (!disableFocusManagement && this.hiddenInput && this.showQuickKeys) {
        this.hiddenInput.focus();
      }
    });
  };

  private startFocusRetention(): void {
    this.focusRetentionInterval = setInterval(() => {
      const disableFocusManagement = this.callbacks?.getDisableFocusManagement() ?? false;
      const showMobileInput = this.callbacks?.getShowMobileInput() ?? false;
      const showCtrlAlpha = this.callbacks?.getShowCtrlAlpha() ?? false;

      // In keyboard mode, always maintain focus regardless of other conditions
      if (this.keyboardMode && this.hiddenInput && document.activeElement !== this.hiddenInput) {
        logger.log('Keyboard mode: forcing focus on hidden input');
        this.hiddenInput.focus();
        return;
      }

      // Normal focus retention for quick keys
      if (
        !disableFocusManagement &&
        this.showQuickKeys &&
        this.hiddenInput &&
        document.activeElement !== this.hiddenInput &&
        !showMobileInput &&
        !showCtrlAlpha
      ) {
        logger.log('Refocusing hidden input to maintain keyboard');
        this.hiddenInput.focus();
      }
    }, 100) as unknown as number; // More frequent checks (100ms instead of 300ms)
  }

  private delayedRefocusHiddenInput(): void {
    setTimeout(() => {
      const disableFocusManagement = this.callbacks?.getDisableFocusManagement() ?? false;
      if (!disableFocusManagement && this.hiddenInput) {
        this.hiddenInput.focus();
      }
    }, 100);
  }

  shouldRefocusHiddenInput(): boolean {
    const disableFocusManagement = this.callbacks?.getDisableFocusManagement() ?? false;
    return !disableFocusManagement && !!this.hiddenInput && this.showQuickKeys;
  }

  refocusHiddenInput(): void {
    setTimeout(() => {
      const disableFocusManagement = this.callbacks?.getDisableFocusManagement() ?? false;
      if (!disableFocusManagement && this.hiddenInput) {
        this.hiddenInput.focus();
      }
    }, 100);
  }

  startFocusRetentionPublic(): void {
    this.startFocusRetention();
  }

  delayedRefocusHiddenInputPublic(): void {
    this.delayedRefocusHiddenInput();
  }

  private updateHiddenInputPosition(): void {
    if (!this.hiddenInput) return;

    if (this.keyboardMode) {
      // In keyboard mode: cover the terminal to receive input
      this.hiddenInput.style.position = 'absolute';
      this.hiddenInput.style.top = '0';
      this.hiddenInput.style.left = '0';
      this.hiddenInput.style.width = '100%';
      this.hiddenInput.style.height = '1px';
      this.hiddenInput.style.zIndex = String(Z_INDEX.TERMINAL_OVERLAY);
      this.hiddenInput.style.pointerEvents = 'none';
    } else {
      // In scroll mode: position off-screen
      this.hiddenInput.style.position = 'fixed';
      this.hiddenInput.style.left = '-9999px';
      this.hiddenInput.style.top = '-9999px';
      this.hiddenInput.style.width = '1px';
      this.hiddenInput.style.height = '1px';
      this.hiddenInput.style.zIndex = '-1';
      this.hiddenInput.style.pointerEvents = 'none';
    }
  }

  private triggerNativePasteWithHiddenInput(): void {
    if (!this.hiddenInput) {
      logger.error('No hidden input available for paste fallback');
      return;
    }

    logger.log('Making hidden input temporarily visible for paste');

    // Store original styles to restore later
    const originalStyles = {
      position: this.hiddenInput.style.position,
      opacity: this.hiddenInput.style.opacity,
      left: this.hiddenInput.style.left,
      top: this.hiddenInput.style.top,
      width: this.hiddenInput.style.width,
      height: this.hiddenInput.style.height,
      backgroundColor: this.hiddenInput.style.backgroundColor,
      border: this.hiddenInput.style.border,
      borderRadius: this.hiddenInput.style.borderRadius,
      padding: this.hiddenInput.style.padding,
      zIndex: this.hiddenInput.style.zIndex,
    };

    // Make the input visible and positioned for interaction
    this.hiddenInput.style.position = 'fixed';
    this.hiddenInput.style.left = '50%';
    this.hiddenInput.style.top = '50%';
    this.hiddenInput.style.transform = 'translate(-50%, -50%)';
    this.hiddenInput.style.width = '200px';
    this.hiddenInput.style.height = '40px';
    this.hiddenInput.style.opacity = '1';
    this.hiddenInput.style.backgroundColor = 'white';
    this.hiddenInput.style.border = '2px solid #007AFF';
    this.hiddenInput.style.borderRadius = '8px';
    this.hiddenInput.style.padding = '8px';
    this.hiddenInput.style.zIndex = '10000';
    this.hiddenInput.placeholder = 'Long-press to paste';

    const restoreStyles = () => {
      if (!this.hiddenInput) return;

      // Restore all original styles
      Object.entries(originalStyles).forEach(([key, value]) => {
        if (value !== undefined) {
          if (this.hiddenInput?.style) {
            (this.hiddenInput.style as unknown as Record<string, string>)[key] = value;
          }
        }
      });
      this.hiddenInput.placeholder = '';
      logger.log('Restored hidden input to original state');
    };

    // Create a one-time paste event handler
    const handlePasteEvent = (e: ClipboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const clipboardData = e.clipboardData?.getData('text/plain');
      logger.log('Native paste event received, text length:', clipboardData?.length || 0);

      if (clipboardData && this.inputManager) {
        logger.log('Sending native paste text to terminal');
        this.inputManager.sendInputText(clipboardData);
      } else {
        logger.warn('No clipboard data received in paste event');
      }

      // Clean up
      this.hiddenInput?.removeEventListener('paste', handlePasteEvent);
      restoreStyles();
      logger.log('Removed paste event listener and restored styles');
    };

    // Add paste event listener
    this.hiddenInput.addEventListener('paste', handlePasteEvent);

    // Focus and select the now-visible input
    this.hiddenInput.focus();
    this.hiddenInput.select();

    logger.log('Input is now visible and focused - long-press to see paste menu');

    // Clean up after timeout if no paste occurs
    setTimeout(() => {
      if (this.hiddenInput) {
        this.hiddenInput.removeEventListener('paste', handlePasteEvent);
        restoreStyles();
        logger.log('Paste timeout - restored input to hidden state');
      }
    }, 10000); // 10 second timeout
  }

  private setupGlobalPasteListener(): void {
    // Listen for paste events anywhere in the document
    // This catches CMD+V or context menu paste when the hidden input is focused
    this.globalPasteHandler = (e: Event) => {
      const pasteEvent = e as ClipboardEvent;
      // Only handle if our hidden input is focused and we're in keyboard mode
      if (this.hiddenInput && document.activeElement === this.hiddenInput && this.showQuickKeys) {
        const clipboardData = pasteEvent.clipboardData?.getData('text/plain');
        if (clipboardData && this.inputManager) {
          logger.log('Global paste event captured, text length:', clipboardData.length);
          this.inputManager.sendInputText(clipboardData);
          pasteEvent.preventDefault();
          pasteEvent.stopPropagation();
        }
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('paste', this.globalPasteHandler);
      logger.log('Global paste listener setup for CMD+V support');
    }
  }

  private dismissKeyboard(): void {
    // Exit keyboard mode
    this.keyboardMode = false;
    this.keyboardModeTimestamp = 0;

    // Remove capture click handler
    if (this.captureClickHandler) {
      document.removeEventListener('click', this.captureClickHandler, true);
      document.removeEventListener('pointerdown', this.captureClickHandler, true);
      this.captureClickHandler = null;
    }

    // Hide quick keys
    this.showQuickKeys = false;
    if (this.callbacks) {
      this.callbacks.updateShowQuickKeys(false);
      // Reset keyboard height when dismissing
      this.callbacks.setKeyboardHeight(0);
    }

    // Stop focus retention
    if (this.focusRetentionInterval) {
      clearInterval(this.focusRetentionInterval);
      this.focusRetentionInterval = null;
    }

    // Stop any keyboard activation attempts
    if (this.keyboardActivationTimeout) {
      clearTimeout(this.keyboardActivationTimeout);
      this.keyboardActivationTimeout = null;
    }

    // Blur the hidden input and move it off-screen
    if (this.hiddenInput) {
      this.hiddenInput.blur();
      this.hiddenInputFocused = false;
      this.updateHiddenInputPosition();
    }

    logger.log('Keyboard dismissed');
  }

  cleanup(): void {
    // Clear timers
    if (this.focusRetentionInterval) {
      clearInterval(this.focusRetentionInterval);
      this.focusRetentionInterval = null;
    }
    if (this.keyboardActivationTimeout) {
      clearTimeout(this.keyboardActivationTimeout);
      this.keyboardActivationTimeout = null;
    }

    // Remove capture click handler
    if (this.captureClickHandler) {
      document.removeEventListener('click', this.captureClickHandler, true);
      document.removeEventListener('pointerdown', this.captureClickHandler, true);
      this.captureClickHandler = null;
    }

    // Remove global paste listener
    if (this.globalPasteHandler) {
      document.removeEventListener('paste', this.globalPasteHandler);
      this.globalPasteHandler = null;
    }

    // Remove hidden input if it exists
    if (this.hiddenInput) {
      this.hiddenInput.remove();
      this.hiddenInput = null;
    }
  }
}
