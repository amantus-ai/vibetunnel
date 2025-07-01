/**
 * Session-related constants for tests
 */

// Session states
export const SESSION_STATE = {
  RUNNING: 'RUNNING',
  EXITED: 'EXITED',
  EXIT: 'EXIT',
  KILLED: 'KILLED',
  KILLING: 'KILLING',
} as const;

export type SessionState = (typeof SESSION_STATE)[keyof typeof SESSION_STATE];

// Session status text (lowercase versions for UI)
export const SESSION_STATUS_TEXT = {
  exited: 'exited',
  exit: 'exit',
  killed: 'killed',
  killing: 'killing',
} as const;

// Default values
export const SESSION_DEFAULTS = {
  COMMAND: 'bash',
  TIMEOUT: 30000, // 30 seconds
  CLEANUP_AGE: 60000, // 1 minute
  POOL_SIZE: 3,
} as const;

// UI selectors
export const SESSION_SELECTORS = {
  CREATE_BUTTON: 'button[title="Create New Session"]',
  SESSION_CARD: 'session-card',
  SESSION_NAME_INPUT: '[data-testid="session-name-input"]',
  COMMAND_INPUT: '[data-testid="command-input"]',
  SPAWN_WINDOW_TOGGLE: 'button[role="switch"]',
  KILL_ALL_BUTTON: 'button:has-text("Kill All")',
} as const;

// API endpoints
export const SESSION_ENDPOINTS = {
  LIST: '/api/sessions',
  CREATE: '/api/sessions',
  DELETE: (id: string) => `/api/sessions/${id}`,
  INPUT: (id: string) => `/api/sessions/${id}/input`,
  RESIZE: (id: string) => `/api/sessions/${id}/resize`,
  KILL: (id: string) => `/api/sessions/${id}/kill`,
} as const;
