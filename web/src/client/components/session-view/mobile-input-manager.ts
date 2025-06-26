/**
 * Mobile Input Manager
 *
 * Manages mobile-specific input handling for terminal sessions,
 * including keyboard overlays and direct input modes.
 */
import { createLogger } from '../../utils/logger.js';
import type { Terminal } from '../terminal.js';
import type { InputManager } from './input-manager.js';

const logger = createLogger('mobile-input-manager');

// Forward declaration for SessionView to avoid circular dependency
interface SessionViewInterface {
  // We'll add methods as needed
  requestUpdate(): void;
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

  // Basic toggle method - initial functionality
  handleMobileInputToggle() {
    // Placeholder for mobile input toggle logic
    logger.debug('Mobile input toggle requested');
  }
}
