/**
 * Test configuration constants for Playwright tests
 */

export const TEST_TIMEOUTS = {
  QUICK: 2000,
  DEFAULT: 5000,
  LONG: 15000,
  NETWORK_QUIET: 3000,
} as const;

export const POOL_CONFIG = {
  DEFAULT_SIZE: 5,
  DEFAULT_COMMAND: 'bash',
  CLEAR_DELAY_MS: 100,
} as const;

export const CLEANUP_CONFIG = {
  DEFAULT_AGE_MINUTES: 30,
  PATTERN_PREFIX: /^(test-|pool-|batch-)/,
} as const;

export const BATCH_CONFIG = {
  MAX_CONCURRENT_DELETES: 10,
} as const;
