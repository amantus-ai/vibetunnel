/**
 * Mobile Input Manager
 *
 * Manages mobile-specific input handling for terminal sessions,
 * including keyboard overlays and direct input modes.
 */
import type { Terminal } from '../terminal.js';
import type { InputManager } from './input-manager.js';

// Forward declaration for SessionView to avoid circular dependency
interface SessionViewInterface {
  // Methods to be called by the manager
  toggleMobileInputDisplay(): void;
  shouldUseDirectKeyboard(): boolean;
  focusHiddenInput(): void;
  refreshTerminalAfterMobileInput(): void;
  getMobileInputText(): string;
  clearMobileInputText(): void;
  closeMobileInput(): void;
  requestUpdate(): void;
  querySelector(selector: string): Element | null;
  shouldRefocusHiddenInput(): boolean;
  refocusHiddenInput(): void;
}

export class MobileInputManager {
  private sessionView: SessionViewInterface;
  private inputManager: InputManager | null = null;
  private terminal: Terminal | null = null;

  constructor(sessionView: SessionViewInterface) {
    this.sessionView = sessionView;
  }

  setInputManager(inputManager: InputManager | null) {
    this.inputManager = inputManager;
  }

  setTerminal(terminal: Terminal | null) {
    this.terminal = terminal;
  }

  handleMobileInputToggle() {
    // If direct keyboard is enabled, focus a hidden input instead of showing overlay
    if (this.sessionView.shouldUseDirectKeyboard()) {
      this.sessionView.focusHiddenInput();
      return;
    }

    this.sessionView.toggleMobileInputDisplay();
  }

  async handleMobileInputSendOnly() {
    // Get the current value from the textarea directly
    const textarea = this.sessionView.querySelector(
      '#mobile-input-textarea'
    ) as HTMLTextAreaElement;
    const textToSend = textarea?.value?.trim() || this.sessionView.getMobileInputText().trim();

    if (!textToSend) return;

    try {
      // Send text without enter key
      if (this.inputManager) {
        await this.inputManager.sendInputText(textToSend);
      }

      // Clear both the reactive property and textarea
      this.sessionView.clearMobileInputText();
      if (textarea) {
        textarea.value = '';
      }

      // Trigger re-render to update button state
      this.sessionView.requestUpdate();

      // Hide the input overlay after sending
      this.sessionView.closeMobileInput();

      // Refocus the hidden input to restore keyboard functionality
      if (this.sessionView.shouldRefocusHiddenInput()) {
        this.sessionView.refocusHiddenInput();
      }

      // Refresh terminal scroll position after closing mobile input
      this.sessionView.refreshTerminalAfterMobileInput();
    } catch (error) {
      console.error('error sending mobile input', error);
      // Don't hide the overlay if there was an error
    }
  }

  async handleMobileInputSend() {
    // Get the current value from the textarea directly
    const textarea = this.sessionView.querySelector(
      '#mobile-input-textarea'
    ) as HTMLTextAreaElement;
    const textToSend = textarea?.value?.trim() || this.sessionView.getMobileInputText().trim();

    if (!textToSend) return;

    try {
      // Add enter key at the end to execute the command
      if (this.inputManager) {
        await this.inputManager.sendInputText(textToSend);
        await this.inputManager.sendInputText('enter');
      }

      // Clear both the reactive property and textarea
      this.sessionView.clearMobileInputText();
      if (textarea) {
        textarea.value = '';
      }

      // Trigger re-render to update button state
      this.sessionView.requestUpdate();

      // Hide the input overlay after sending
      this.sessionView.closeMobileInput();

      // Refocus the hidden input to restore keyboard functionality
      if (this.sessionView.shouldRefocusHiddenInput()) {
        this.sessionView.refocusHiddenInput();
      }

      // Refresh terminal scroll position after closing mobile input
      this.sessionView.refreshTerminalAfterMobileInput();
    } catch (error) {
      console.error('error sending mobile input', error);
      // Don't hide the overlay if there was an error
    }
  }
}
