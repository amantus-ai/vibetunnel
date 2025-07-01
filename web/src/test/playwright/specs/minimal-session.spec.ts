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
    await page.waitForSelector('session-card', {
      state: 'visible',
      timeout: process.env.CI ? 10000 : 3000,
    });

    // Verify session is listed
    await assertSessionInList(page, sessionName);
  });

  test('should create multiple sessions', async ({ page }) => {
    // Increase timeout for this test as it creates multiple sessions
    test.setTimeout(120000); // 2 minutes for CI environment

    const sessionNames = [];

    // Create 3 sessions using the session manager
    for (let i = 0; i < 3; i++) {
      const { sessionName } = await sessionManager.createTrackedSession(`minimal-test-${i + 1}`);
      sessionNames.push(sessionName);

      // Navigate back to home after each creation
      console.log(`[Test] Navigating back to home after creating session ${i + 1}...`);
      await page.goto('/', {
        waitUntil: 'domcontentloaded',
        timeout: process.env.CI ? 60000 : 30000,
      });

      // Wait for app to be ready first
      console.log('[Test] Waiting for app element...');
      await page.waitForSelector('vibetunnel-app', {
        state: 'attached',
        timeout: process.env.CI ? 30000 : 15000,
      });

      // Then wait for session cards to appear
      try {
        console.log('[Test] Waiting for session cards to appear...');
        await page.waitForSelector('session-card', {
          state: 'visible',
          timeout: process.env.CI ? 30000 : 15000,
        });
        console.log(`[Test] Session cards visible after creating session ${i + 1}`);
      } catch (error) {
        // If no session cards, check if we're on the right page
        const url = page.url();
        const title = await page.title();
        console.error(`[Test] Failed to find session-card. URL: ${url}, Title: ${title}`);

        // Log page content for debugging
        const content = await page.content();
        console.error('[Test] Page content preview:', content.substring(0, 500));

        throw error;
      }

      // Small delay between session creations
      if (i < 2) {
        await page.waitForTimeout(500);
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
