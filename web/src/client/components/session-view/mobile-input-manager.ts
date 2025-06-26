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
}
