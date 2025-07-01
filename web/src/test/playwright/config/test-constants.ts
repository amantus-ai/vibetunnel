/**
 * Test configuration constants for Playwright tests
 */

export const TEST_TIMEOUTS = {
  QUICK: process.env.CI ? 5000 : 2000,
  DEFAULT: process.env.CI ? 10000 : 5000,
  LONG: process.env.CI ? 30000 : 15000,
  NETWORK_QUIET: process.env.CI ? 5000 : 3000,
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
