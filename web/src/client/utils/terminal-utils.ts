import { createLogger } from './logger.js';

const logger = createLogger('terminal-utils');

export interface TerminalElement extends HTMLElement {
  fitTerminal?: () => void;
}

/**
 * Triggers a terminal resize event for proper dimensions
 * @param sessionId - The session ID for logging purposes
 * @param container - Optional container to search within
 */
export function triggerTerminalResize(sessionId: string, container?: HTMLElement): void {
  requestAnimationFrame(() => {
    const searchRoot = container || document;
    const terminal = searchRoot.querySelector('vibe-terminal') as TerminalElement;

    if (terminal?.fitTerminal) {
      logger.debug(`triggering terminal resize for session ${sessionId}`);
      terminal.fitTerminal();
    } else {
      logger.warn(`terminal not found or fitTerminal method unavailable for session ${sessionId}`);
    }
  });
}

/**
 * Debounced version of terminal resize trigger
 */
export function createDebouncedTerminalResize(delay = 100) {
  let timeoutId: number | undefined;

  return (sessionId: string, container?: HTMLElement) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = window.setTimeout(() => {
      triggerTerminalResize(sessionId, container);
    }, delay);
  };
}
