/**
 * Shared timeout constants for Playwright tests
 * All values are in milliseconds
 */
export const TIMEOUTS = {
  // UI Update timeouts
  UI_UPDATE: 500,
  UI_ANIMATION: 300,

  // Button and element visibility
  BUTTON_VISIBILITY: 1000,
  ELEMENT_VISIBILITY: 2000,

  // Session operations
  SESSION_CREATION: 5000,
  SESSION_TRANSITION: 2000,
  SESSION_KILL: 10000,
  KILL_ALL_OPERATION: 30000,

  // Terminal operations
  TERMINAL_READY: 4000,
  TERMINAL_PROMPT: 5000,
  TERMINAL_COMMAND: 2000,
  TERMINAL_RESIZE: 2000,

  // Page operations
  PAGE_LOAD: 10000,
  NAVIGATION: 5000,

  // Modal operations
  MODAL_ANIMATION: 2000,

  // Network operations
  API_RESPONSE: 5000,

  // Test-specific
  ASSERTION_RETRY: 10000,
  DEBUG_WAIT: 2000,
} as const;

// Type for timeout keys
export type TimeoutKey = keyof typeof TIMEOUTS;
