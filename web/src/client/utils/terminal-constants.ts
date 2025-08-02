/**
 * Terminal component constants and selectors
 *
 * Centralized definitions to prevent breaking changes when IDs or classes are modified
 */

/**
 * HTML element IDs used across terminal components
 */
export const TERMINAL_IDS = {
  /** Main session container element */
  SESSION_TERMINAL: 'session-terminal',
  /** Buffer container for vibe-terminal-buffer component */
  BUFFER_CONTAINER: 'buffer-container',
  /** Terminal container for terminal.ts component */
  TERMINAL_CONTAINER: 'terminal-container',
} as const;
