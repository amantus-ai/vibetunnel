import { expect, test } from '../fixtures/test.fixture';
import { assertSessionInList } from '../helpers/assertion.helper';
import { createMultipleSessions } from '../helpers/session-lifecycle.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

test.describe('Minimal Session Tests', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });
  test('should create and list a session', async ({ page }) => {
    // Create a tracked session
    const { sessionName } = await sessionManager.createTrackedSession();

    // Navigate back to home
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    // Verify session is listed
    await assertSessionInList(page, sessionName);
  });

  test('should create multiple sessions', async ({ page }) => {
    // Create 3 sessions using helper
    const sessions = await createMultipleSessions(page, 3, {
      name: 'minimal-test',
    });

    // Navigate back to home
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    // Verify all sessions are listed
    for (const session of sessions) {
      await assertSessionInList(page, session.sessionName);
    }

    // Count total session cards (should be at least our 3)
    const totalCards = await page.locator('session-card').count();
    expect(totalCards).toBeGreaterThanOrEqual(3);
  });
});
