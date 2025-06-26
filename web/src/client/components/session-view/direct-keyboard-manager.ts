/**
 * Direct Keyboard Input Manager
 *
 * Manages hidden input element and direct keyboard input for mobile devices.
 * Handles focus management, input events, and quick key interactions.
 */
import { createLogger } from '../../utils/logger.js';
import type { InputManager } from './input-manager.js';

const logger = createLogger('direct-keyboard-manager');

export interface DirectKeyboardCallbacks {
  getShowMobileInput(): boolean;
  getShowCtrlAlpha(): boolean;
  getDisableFocusManagement(): boolean;
  getVisualViewportHandler(): (() => void) | null;
  getKeyboardHeight(): number;
  updateShowQuickKeys(value: boolean): void;
  toggleMobileInput(): void;
  clearMobileInputText(): void;
  toggleCtrlAlpha(): void;
  clearCtrlSequence(): void;
}

export class DirectKeyboardManager {
  private hiddenInput: HTMLInputElement | null = null;
  private focusRetentionInterval: number | null = null;
  private instanceId: string;
  private inputManager: InputManager | null = null;
  private sessionViewElement: HTMLElement | null = null;
  private callbacks: DirectKeyboardCallbacks | null = null;
  private showQuickKeys = false;
  private hiddenInputFocused = false;

  constructor(instanceId: string) {
    this.instanceId = instanceId;
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

      // Blur the hidden input
      if (this.hiddenInput) {
        this.hiddenInput.blur();
      }

      logger.log('Quick keys force hidden by external trigger');
    }
  }

  focusHiddenInput(): void {
    // Just delegate to the new method
    this.ensureHiddenInputVisible();
  }

  ensureHiddenInputVisible(): void {
    if (!this.hiddenInput) {
      this.createHiddenInput();
    }

    // Don't automatically show quick keys - wait for keyboard to actually appear
    // The keyboard visibility will be detected by the visual viewport handler
    const keyboardHeight = this.callbacks?.getKeyboardHeight() ?? 0;
    if (keyboardHeight > 50 && this.hiddenInputFocused) {
      this.showQuickKeys = true;
      if (this.callbacks) {
        this.callbacks.updateShowQuickKeys(true);
      }
    }

    // The input should already be covering the terminal and be focusable
    // The user's tap on the terminal is actually a tap on the input
  }

  private createHiddenInput(): void {
    this.hiddenInput = document.createElement('input');
    this.hiddenInput.type = 'text';
    this.hiddenInput.style.position = 'absolute';
    this.hiddenInput.style.top = '0';
    this.hiddenInput.style.left = '0';
    this.hiddenInput.style.width = '100%';
    this.hiddenInput.style.height = '100%';
    this.hiddenInput.style.opacity = '0'; // Completely transparent
    this.hiddenInput.style.fontSize = '16px'; // Prevent zoom on iOS
    this.hiddenInput.style.zIndex = '10'; // Above terminal content
    this.hiddenInput.style.border = 'none';
    this.hiddenInput.style.outline = 'none';
    this.hiddenInput.style.background = 'transparent';
    this.hiddenInput.style.color = 'transparent';
    this.hiddenInput.style.caretColor = 'transparent'; // Hide the cursor
    this.hiddenInput.style.cursor = 'default'; // Normal cursor
    this.hiddenInput.autocapitalize = 'off';
    this.hiddenInput.autocomplete = 'off';
    this.hiddenInput.setAttribute('autocorrect', 'off');
    this.hiddenInput.setAttribute('spellcheck', 'false');
    this.hiddenInput.setAttribute('aria-hidden', 'true');

    // Make it visible for debugging (comment out in production)
    // this.hiddenInput.style.opacity = '0.1';
    // this.hiddenInput.style.background = 'rgba(255,0,0,0.1)';

    // Prevent click events from propagating to terminal
    this.hiddenInput.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
    });

    // Also handle touchstart to ensure mobile taps don't propagate
    this.hiddenInput.addEventListener('touchstart', (e) => {
      e.stopPropagation();
    });

    // Handle input events
    this.hiddenInput.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.value) {
        // Don't send input to terminal if mobile input overlay or Ctrl overlay is visible
        const showMobileInput = this.callbacks?.getShowMobileInput() ?? false;
        const showCtrlAlpha = this.callbacks?.getShowCtrlAlpha() ?? false;
        if (!showMobileInput && !showCtrlAlpha && this.inputManager) {
          // Send each character to terminal
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
        this.inputManager.sendInputText('enter');
      } else if (e.key === 'Backspace' && this.inputManager) {
        // Always send backspace to terminal
        this.inputManager.sendInputText('backspace');
      } else if (e.key === 'Tab' && this.inputManager) {
        this.inputManager.sendInputText('tab');
      } else if (e.key === 'Escape' && this.inputManager) {
        this.inputManager.sendInputText('escape');
      }
    });

    // Handle focus/blur for quick keys visibility
    this.hiddenInput.addEventListener('focus', () => {
      this.hiddenInputFocused = true;
      // Only show quick keys if keyboard is actually visible
      const keyboardHeight = this.callbacks?.getKeyboardHeight() ?? 0;
      if (keyboardHeight > 50) {
        this.showQuickKeys = true;
        if (this.callbacks) {
          this.callbacks.updateShowQuickKeys(true);
        }
      }
      logger.log(
        `Hidden input focused, keyboard height: ${keyboardHeight}, showQuickKeys: ${this.showQuickKeys}`
      );

      // Trigger initial keyboard height calculation
      const visualViewportHandler = this.callbacks?.getVisualViewportHandler();
      if (visualViewportHandler) {
        visualViewportHandler();
      }

      // Start focus retention
      if (this.focusRetentionInterval) {
        clearInterval(this.focusRetentionInterval);
      }

      this.focusRetentionInterval = setInterval(() => {
        const disableFocusManagement = this.callbacks?.getDisableFocusManagement() ?? false;
        const showMobileInput = this.callbacks?.getShowMobileInput() ?? false;
        const showCtrlAlpha = this.callbacks?.getShowCtrlAlpha() ?? false;
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
      }, 300) as unknown as number;
    });

    this.hiddenInput.addEventListener('blur', (e) => {
      const _event = e as FocusEvent;

      // Immediately try to recapture focus
      const disableFocusManagement = this.callbacks?.getDisableFocusManagement() ?? false;
      if (!disableFocusManagement && this.showQuickKeys && this.hiddenInput) {
        // Use a very short timeout to allow any legitimate focus changes to complete
        setTimeout(() => {
          if (
            !disableFocusManagement &&
            this.showQuickKeys &&
            this.hiddenInput &&
            document.activeElement !== this.hiddenInput
          ) {
            // Check if focus went to a quick key or somewhere else in our component
            const activeElement = document.activeElement;
            const isWithinComponent = this.sessionViewElement?.contains(activeElement) ?? false;

            if (isWithinComponent || !activeElement || activeElement === document.body) {
              // Focus was lost to nowhere specific or within our component - recapture it
              logger.log('Recapturing focus on hidden input');
              this.hiddenInput.focus();
            } else {
              // Focus went somewhere legitimate outside our component
              // Wait a bit longer before hiding quick keys
              setTimeout(() => {
                if (document.activeElement !== this.hiddenInput) {
                  this.hiddenInputFocused = false;
                  this.showQuickKeys = false;
                  if (this.callbacks) {
                    this.callbacks.updateShowQuickKeys(false);
                  }
                  logger.log('Hidden input blurred, hiding quick keys');

                  // Clear focus retention interval
                  if (this.focusRetentionInterval) {
                    clearInterval(this.focusRetentionInterval);
                    this.focusRetentionInterval = null;
                  }
                }
              }, 500);
            }
          }
        }, 10);
      }
    });

    // Add to the terminal container to overlay it
    const terminalContainer = this.sessionViewElement?.querySelector('#terminal-container');
    if (terminalContainer) {
      terminalContainer.appendChild(this.hiddenInput);
    }
  }

  handleQuickKeyPress = (key: string, isModifier?: boolean, isSpecial?: boolean): void => {
    if (isSpecial && key === 'ABC') {
      // Toggle the mobile input overlay
      if (this.callbacks) {
        this.callbacks.toggleMobileInput();
      }

      const showMobileInput = this.callbacks?.getShowMobileInput() ?? false;
      if (showMobileInput) {
        // Stop focus retention when showing mobile input
        if (this.focusRetentionInterval) {
          clearInterval(this.focusRetentionInterval);
          this.focusRetentionInterval = null;
        }

        // Blur the hidden input to prevent it from capturing input
        if (this.hiddenInput) {
          this.hiddenInput.blur();
        }
      } else {
        // Clear the text when closing
        if (this.callbacks) {
          this.callbacks.clearMobileInputText();
        }

        // Restart focus retention when closing mobile input
        const disableFocusManagement = this.callbacks?.getDisableFocusManagement() ?? false;
        if (!disableFocusManagement && this.hiddenInput && this.showQuickKeys) {
          this.startFocusRetention();
          this.delayedRefocusHiddenInput();
        }
      }
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
    } else if (key === 'Ctrl+A' && this.inputManager) {
      // Send Ctrl+A (start of line)
      this.inputManager.sendInputText('\x01');
    } else if (key === 'Ctrl+C' && this.inputManager) {
      // Send Ctrl+C (interrupt signal)
      this.inputManager.sendInputText('\x03');
    } else if (key === 'Ctrl+D' && this.inputManager) {
      // Send Ctrl+D (EOF)
      this.inputManager.sendInputText('\x04');
    } else if (key === 'Ctrl+E' && this.inputManager) {
      // Send Ctrl+E (end of line)
      this.inputManager.sendInputText('\x05');
    } else if (key === 'Ctrl+K' && this.inputManager) {
      // Send Ctrl+K (kill to end of line)
      this.inputManager.sendInputText('\x0b');
    } else if (key === 'Ctrl+L' && this.inputManager) {
      // Send Ctrl+L (clear screen)
      this.inputManager.sendInputText('\x0c');
    } else if (key === 'Ctrl+R' && this.inputManager) {
      // Send Ctrl+R (reverse search)
      this.inputManager.sendInputText('\x12');
    } else if (key === 'Ctrl+U' && this.inputManager) {
      // Send Ctrl+U (clear line)
      this.inputManager.sendInputText('\x15');
    } else if (key === 'Ctrl+W' && this.inputManager) {
      // Send Ctrl+W (delete word)
      this.inputManager.sendInputText('\x17');
    } else if (key === 'Ctrl+Z' && this.inputManager) {
      // Send Ctrl+Z (suspend signal)
      this.inputManager.sendInputText('\x1a');
    } else if (key === 'Option' && this.inputManager) {
      // Send ESC prefix for Option/Alt key
      this.inputManager.sendInputText('\x1b');
    } else if (key === 'Command') {
      // Command key doesn't have a direct terminal equivalent
      // Could potentially show a message or ignore
      return;
    } else if (key === 'Delete' && this.inputManager) {
      // Send delete key
      this.inputManager.sendInputText('delete');
    } else if (key.startsWith('F') && this.inputManager) {
      // Handle function keys F1-F12
      const fNum = Number.parseInt(key.substring(1));
      if (fNum >= 1 && fNum <= 12) {
        this.inputManager.sendInputText(`f${fNum}`);
      }
    } else if (this.inputManager) {
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
      this.inputManager.sendInputText(keyToSend.toLowerCase());
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
    }, 300) as unknown as number;
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

  cleanup(): void {
    // Clear focus retention interval
    if (this.focusRetentionInterval) {
      clearInterval(this.focusRetentionInterval);
      this.focusRetentionInterval = null;
    }

    // Remove hidden input if it exists
    if (this.hiddenInput) {
      this.hiddenInput.remove();
      this.hiddenInput = null;
    }
  }
}
