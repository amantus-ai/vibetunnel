import { test as base } from '@playwright/test';
import { CLEANUP_CONFIG, POOL_CONFIG } from '../config/test-constants';
import { BatchOperations } from '../helpers/batch-operations.helper';
import { SessionCleanupHelper } from '../helpers/session-cleanup.helper';
import { SessionPool } from '../helpers/session-pool.helper';
import { logger } from '../utils/logger';
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
  waitUtils: async (_, use) => {
    await use(OptimizedWaitUtils);
  },
});

export { expect } from '@playwright/test';

// Hook for global setup/teardown
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  const cleanup = new SessionCleanupHelper(page);

  // Clean up any leftover sessions from previous runs
  const cleaned = await cleanup.cleanupOldSessions(60); // 1 hour old
  if (cleaned > 0) {
    logger.info(`Cleaned up ${cleaned} old sessions before test run`);
  }

  await page.close();
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  const cleanup = new SessionCleanupHelper(page);

  // Final cleanup of test sessions
  const cleaned = await cleanup.cleanupByPattern(CLEANUP_CONFIG.PATTERN_PREFIX);
  if (cleaned > 0) {
    logger.info(`Cleaned up ${cleaned} test sessions after test run`);
  }

  await page.close();
});
