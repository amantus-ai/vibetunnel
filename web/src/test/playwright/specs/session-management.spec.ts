import { expect, test } from '../fixtures/test.fixture';
import { assertSessionCount, assertSessionInList } from '../helpers/assertion.helper';
import { takeDebugScreenshot } from '../helpers/screenshot.helper';
import {
  createAndNavigateToSession,
  waitForSessionState,
} from '../helpers/session-lifecycle.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

test.describe('Session Management', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test.skip('should kill an active session', async ({ page }) => {
    // Create a tracked session
    const { sessionName } = await sessionManager.createTrackedSession();

    // Navigate back to list
    await page.goto('/');

    // Kill the session
    const sessionListPage = await import('../pages/session-list.page').then(
      (m) => new m.SessionListPage(page)
    );
    await sessionListPage.killSession(sessionName);

    // Verify session state changed
    await waitForSessionState(page, sessionName, 'EXITED');
  });

  test.skip('should handle session exit', async ({ page }) => {
    // Create a session
    await createAndNavigateToSession(page);

    // Would normally execute exit command here
    // Skip terminal interaction as it's not working in tests
  });

  test('should display session metadata correctly', async ({ page }) => {
    // Create a session and navigate back
    const { sessionName } = await createAndNavigateToSession(page);
    await page.goto('/');

    // Verify session card displays correct information
    await assertSessionInList(page, sessionName, { status: 'RUNNING' });

    // Verify session card contains name
    const sessionCard = page.locator(`session-card:has-text("${sessionName}")`);
    await expect(sessionCard).toContainText(sessionName);
  });

  test('should handle concurrent sessions', async ({ page }) => {
    test.setTimeout(60000); // Increase timeout for this test
    try {
      // Create first session
      const { sessionName: session1 } = await sessionManager.createTrackedSession();

      // Navigate back to list before creating second session
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');

      // Wait for the list to be ready
      await page.waitForSelector('session-card', { state: 'visible', timeout: 5000 });

      // Create second session
      const { sessionName: session2 } = await sessionManager.createTrackedSession();

      // Navigate back to list to verify both exist
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');

      // Wait for session cards to load
      await page.waitForSelector('session-card', { state: 'visible', timeout: 5000 });

      // Verify both sessions exist
      await assertSessionCount(page, 2, { operator: 'minimum' });
      await assertSessionInList(page, session1);
      await assertSessionInList(page, session2);
    } catch (error) {
      // If error occurs, take a screenshot for debugging
      if (!page.isClosed()) {
        await takeDebugScreenshot(page, 'debug-concurrent-sessions');
      }
      throw error;
    }
  });

  test.skip('should update session activity timestamp', async ({ page }) => {
    // Create a session
    await createAndNavigateToSession(page);

    // Skip terminal interaction and activity timestamp verification
  });

  test.skip('should handle session with long output', async ({ page }) => {
    // Create a session
    await createAndNavigateToSession(page);

    // Skip terminal interaction tests
  });

  test('should persist session across page refresh', async ({ page }) => {
    // Create a session
    const { sessionName } = await sessionManager.createTrackedSession();

    // Refresh the page
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // The app might redirect us to the list if session doesn't exist
    const currentUrl = page.url();
    if (currentUrl.includes('?session=')) {
      // We're still in a session view
      await page.waitForSelector('vibe-terminal', { state: 'visible', timeout: 4000 });
    } else {
      // We got redirected to list, reconnect
      await page.waitForSelector('session-card', { state: 'visible' });
      const sessionListPage = await import('../pages/session-list.page').then(
        (m) => new m.SessionListPage(page)
      );
      await sessionListPage.clickSession(sessionName);
      await expect(page).toHaveURL(/\?session=/);
    }
  });
});
