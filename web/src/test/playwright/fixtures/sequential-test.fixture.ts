import { test as base } from '@playwright/test';
import { CLEANUP_CONFIG, POOL_CONFIG } from '../config/test-constants';
import { BatchOperations } from '../helpers/batch-operations.helper';
import { SessionCleanupHelper } from '../helpers/session-cleanup.helper';
import { SessionPool } from '../helpers/session-pool.helper';
import { OptimizedWaitUtils } from '../utils/optimized-wait.utils';

/**
 * Sequential test fixtures optimized for single-server architecture
 */
type SequentialTestFixtures = {
  cleanupHelper: SessionCleanupHelper;
  batchOps: BatchOperations;
  sessionPool: SessionPool;
  waitUtils: typeof OptimizedWaitUtils;
};

export const test = base.extend<SequentialTestFixtures>({
  // Session cleanup helper
  cleanupHelper: async ({ page }, use) => {
    const helper = new SessionCleanupHelper(page);

    // Clean up old test sessions before starting
    await helper.cleanupByPattern(CLEANUP_CONFIG.PATTERN_PREFIX);

    await use(helper);

    // Clean up after test
    await helper.cleanupByPattern(CLEANUP_CONFIG.PATTERN_PREFIX);
  },

  // Batch operations for efficient API calls
  batchOps: async ({ page }, use) => {
    const batchOps = new BatchOperations(page);
    await use(batchOps);
  },

  // Session pool for test reuse
  sessionPool: async ({ page }, use) => {
    const pool = new SessionPool(page);

    // Initialize small pool for test use
    await pool.initialize(POOL_CONFIG.DEFAULT_SIZE);

    await use(pool);

    // Clean up pool after test
    await pool.cleanup();
  },

  // Optimized wait utilities
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires object destructuring
  waitUtils: async ({}, use) => {
    await use(OptimizedWaitUtils);
  },
});

export { expect } from '@playwright/test';

// Note: Global cleanup is handled by the cleanupHelper fixture
// which runs before and after each test
