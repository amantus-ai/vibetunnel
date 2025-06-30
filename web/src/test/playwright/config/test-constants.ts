/**
 * Test configuration constants for Playwright tests
 */

export const TEST_TIMEOUTS = {
  QUICK: 1000,
  DEFAULT: 3000,
  LONG: 10000,
  NETWORK_QUIET: 2000,
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
