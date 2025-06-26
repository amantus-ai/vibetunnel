/**
 * Direct Keyboard Input Manager
 *
 * Manages hidden input element and direct keyboard input for mobile devices.
 * Handles focus management, input events, and quick key interactions.
 */
import { createLogger } from '../../utils/logger.js';
import type { InputManager } from './input-manager.js';

const _logger = createLogger('direct-keyboard-manager');

export class DirectKeyboardManager {
  private hiddenInput: HTMLInputElement | null = null;
  private focusRetentionInterval: number | null = null;
  private instanceId: string;
  private inputManager: InputManager | null = null;
  private sessionViewElement: HTMLElement | null = null;
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

  getShowQuickKeys(): boolean {
    return this.showQuickKeys;
  }

  ensureHiddenInputVisible(): void {
    if (!this.hiddenInput) {
      this.createHiddenInput();
    }

    // Show quick keys
    this.showQuickKeys = true;

    // The input should already be covering the terminal and be focusable
    // The user's tap on the terminal is actually a tap on the input
  }

  private createHiddenInput(): void {
    // Placeholder for createHiddenInput method - will be implemented in next step
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
