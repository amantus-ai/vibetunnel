import { expect, test } from '../fixtures/test.fixture';
import { assertSessionInList } from '../helpers/assertion.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';
import { SmartWait } from '../helpers/smart-wait.helper';

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
    await page.waitForSelector('session-card', { state: 'visible', timeout: 3000 });

    // Verify session is listed
    await assertSessionInList(page, sessionName);
  });

  test('should create multiple sessions', async ({ page }) => {
    // Increase timeout for this test as it creates multiple sessions
    test.setTimeout(60000);

    const sessionNames = [];

    // Create 3 sessions using the session manager
    for (let i = 0; i < 3; i++) {
      const { sessionName } = await sessionManager.createTrackedSession(`minimal-test-${i + 1}`);
      sessionNames.push(sessionName);

      // Navigate back to home after each creation
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('session-card', { state: 'visible', timeout: 5000 });

      // Wait for session to be fully created before creating next one
      if (i < 2) {
        await SmartWait.forSessionCreation(page, sessionName);
      }
    }

    // Verify all sessions are listed as running
    for (const sessionName of sessionNames) {
      await assertSessionInList(page, sessionName, { status: 'RUNNING' });
    }

    // Count total session cards (should be at least our 3)
    const totalCards = await page.locator('session-card').count();
    expect(totalCards).toBeGreaterThanOrEqual(3);
  });
});
