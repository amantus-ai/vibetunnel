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
  updateShowQuickKeys(value: boolean): void;
}

export class DirectKeyboardManager {
  private hiddenInput: HTMLInputElement | null = null;
  private focusRetentionInterval: number | null = null;
  private instanceId: string;
  private inputManager: InputManager | null = null;
  private sessionViewElement: HTMLElement | null = null;
  private callbacks: DirectKeyboardCallbacks | null = null;
  private showQuickKeys = false;

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

  focusHiddenInput(): void {
    // Just delegate to the new method
    this.ensureHiddenInputVisible();
  }

  ensureHiddenInputVisible(): void {
    if (!this.hiddenInput) {
      this.createHiddenInput();
    }

    // Show quick keys
    this.showQuickKeys = true;
    if (this.callbacks) {
      this.callbacks.updateShowQuickKeys(true);
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
      this.showQuickKeys = true;
      if (this.callbacks) {
        this.callbacks.updateShowQuickKeys(true);
      }
      logger.log('Hidden input focused, showing quick keys');

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
