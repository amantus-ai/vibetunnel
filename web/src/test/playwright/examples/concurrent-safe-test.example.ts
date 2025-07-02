import { expect, test } from '../fixtures/test.fixture';
import { SessionCleanupHelper } from '../helpers/session-cleanup.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';
import { TestDataFactory } from '../utils/test-utils';

/**
 * Example of a concurrent-safe Playwright test
 *
 * This test demonstrates best practices for writing tests that can run
 * in parallel without interfering with other tests.
 */

// Use a unique prefix for this test suite
const TEST_PREFIX = TestDataFactory.getTestSpecificPrefix('example-tests');

test.describe('Concurrent Safe Example Tests', () => {
  let sessionManager: TestSessionManager;
  let _cleanupHelper: SessionCleanupHelper;

  test.beforeEach(async ({ page }) => {
    // Initialize managers with test-specific prefix
    sessionManager = new TestSessionManager(page, TEST_PREFIX);
    _cleanupHelper = new SessionCleanupHelper(page);
  });

  test.afterEach(async () => {
    // Clean up only our tracked sessions - safe for concurrent execution
    await sessionManager.cleanupAllSessions();

    // Alternative: Use pattern-based cleanup
    // await _cleanupHelper.cleanupByPattern(new RegExp(`^${TEST_PREFIX}`));
  });

  test('should create and manage its own session', async ({ page }) => {
    // Create a session with automatic tracking
    const { sessionName } = await sessionManager.createTrackedSession();

    // Session name will be like: "test-example-tests-1234567890-abc123"
    expect(sessionName).toMatch(new RegExp(`^${TEST_PREFIX}`));

    // Verify session was created
    await expect(page.locator(`session-card:has-text("${sessionName}")`)).toBeVisible();

    // Do test-specific operations...

    // Session will be automatically cleaned up in afterEach
  });

  test('should handle multiple sessions independently', async ({ page }) => {
    // Create multiple sessions for this test
    const sessions = [];

    for (let i = 0; i < 3; i++) {
      const session = await sessionManager.createTrackedSession(`${TEST_PREFIX}-multi-${i}`);
      sessions.push(session);
    }

    // Verify all sessions exist
    for (const { sessionName } of sessions) {
      await expect(page.locator(`session-card:has-text("${sessionName}")`)).toBeVisible();
    }

    // Clean up specific session
    await sessionManager.cleanupSession(sessions[0].sessionName);

    // All remaining sessions will be cleaned up in afterEach
  });

  test('should not interfere with other tests sessions', async ({ page, sessionListPage }) => {
    // Create our test session
    await sessionManager.createTrackedSession();

    // Navigate to session list
    await sessionListPage.navigate();

    // Get all visible sessions
    const allCards = await sessionListPage.getSessionCards();

    // We should only clean up our own sessions, not others
    for (const card of allCards) {
      const cardText = await card.textContent();
      if (cardText?.includes(TEST_PREFIX)) {
        // This is one of our sessions - we can manage it
        console.log(`Found our session: ${cardText}`);
      } else {
        // This belongs to another test - DO NOT TOUCH
        console.log(`Ignoring other test's session: ${cardText}`);
      }
    }

    // Only our sessions will be cleaned up in afterEach
  });

  // Skip this test in parallel mode if it needs exclusive access
  test('should perform system-wide operation', async ({ page }) => {
    test.skip(
      process.env.PLAYWRIGHT_PARALLEL === 'true',
      'This test requires exclusive access - skipped in parallel mode'
    );

    // Test that needs exclusive access to the system
    // For example, testing the "Kill All" functionality
  });
});

/**
 * Best Practices Summary:
 *
 * 1. Use TestSessionManager with a unique prefix per test suite
 * 2. Only clean up sessions you created (tracked sessions)
 * 3. Use pattern-based cleanup as an alternative
 * 4. Skip tests that require exclusive access in parallel mode
 * 5. Never use global cleanup methods that affect all sessions
 * 6. Use descriptive session names with test-specific prefixes
 */
