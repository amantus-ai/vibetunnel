/**
 * Mobile Input Manager
 *
 * Manages mobile-specific input handling for terminal sessions,
 * including keyboard overlays and direct input modes.
 */
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
  startFocusRetention(): void;
  delayedRefocusHiddenInput(): void;
}

export class MobileInputManager {
  private sessionView: SessionViewInterface;
  private inputManager: InputManager | null = null;

  constructor(sessionView: SessionViewInterface) {
    this.sessionView = sessionView;
  }

  setInputManager(inputManager: InputManager | null) {
    this.inputManager = inputManager;
  }

  handleMobileInputToggle() {
    // If direct keyboard is enabled, focus a hidden input instead of showing overlay
    if (this.sessionView.shouldUseDirectKeyboard()) {
      this.sessionView.focusHiddenInput();
      return;
    }

    this.sessionView.toggleMobileInputDisplay();
  }

  async handleMobileInputSendOnly(text: string) {
    // Use the passed text parameter instead of reading from textarea
    const textToSend = text?.trim();

    if (!textToSend) return;

    try {
      // Send text without enter key
      if (this.inputManager) {
        await this.inputManager.sendInputText(textToSend);
      }

      // Clear the reactive property
      this.sessionView.clearMobileInputText();

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

  async handleMobileInputSend(text: string) {
    // Use the passed text parameter instead of reading from textarea
    const textToSend = text?.trim();

    if (!textToSend) return;

    try {
      // Add enter key at the end to execute the command
      if (this.inputManager) {
        await this.inputManager.sendInputText(textToSend);
        // Use sendInput (not sendInputText) for special keys like 'enter'
        await this.inputManager.sendInput('enter');
      }

      // Clear the reactive property
      this.sessionView.clearMobileInputText();

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

  handleMobileInputCancel() {
    this.sessionView.closeMobileInput();
    // Clear the text
    this.sessionView.clearMobileInputText();
    // Restart focus retention
    if (this.sessionView.shouldRefocusHiddenInput()) {
      this.sessionView.startFocusRetention();
      this.sessionView.delayedRefocusHiddenInput();
    }
  }

  cleanup(): void {
    // Clear references to prevent memory leaks
    this.inputManager = null;
    // Note: We don't null sessionView as it's a readonly property
  }
}
