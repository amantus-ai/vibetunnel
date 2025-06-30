import { expect, test } from '../fixtures/test.fixture';
import { assertSessionInList } from '../helpers/assertion.helper';
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
    const sessionNames = [];

    // Create 3 sessions using the session manager
    for (let i = 0; i < 3; i++) {
      const { sessionName } = await sessionManager.createTrackedSession(`minimal-test-${i + 1}`);
      sessionNames.push(sessionName);

      // Navigate back to home after each creation
      await page.goto('/');
      await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });
    }

    // Verify all sessions are listed
    for (const sessionName of sessionNames) {
      await assertSessionInList(page, sessionName);
    }

    // Count total session cards (should be at least our 3)
    const totalCards = await page.locator('session-card').count();
    expect(totalCards).toBeGreaterThanOrEqual(3);
  });
});
