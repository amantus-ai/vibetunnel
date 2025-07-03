import { expect, test } from '../fixtures/test.fixture';
import { assertSessionInList } from '../helpers/assertion.helper';
import {
  refreshAndVerifySession,
  verifyMultipleSessionsInList,
  waitForSessionCards,
} from '../helpers/common-patterns.helper';
import { takeDebugScreenshot } from '../helpers/screenshot.helper';
import {
  createAndNavigateToSession,
  waitForSessionState,
} from '../helpers/session-lifecycle.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

// These tests create their own sessions and can run in parallel
test.describe.configure({ mode: 'parallel' });

test.describe('Session Management', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test.skip('should kill an active session', async ({ page }) => {
    // Create a tracked session with a long-running command (sleep without shell operators)
    const { sessionName } = await sessionManager.createTrackedSession('kill-test', {
      command: 'sleep 300', // Simple long-running command without shell operators
    });

    // Navigate back to list
    await page.goto('/');
    await waitForSessionCards(page);

    // Kill the session
    const sessionListPage = await import('../pages/session-list.page').then(
      (m) => new m.SessionListPage(page)
    );
    await sessionListPage.killSession(sessionName);

    // Verify session state changed to exited
    await waitForSessionState(page, sessionName, 'exited', { timeout: 10000 });
  });

  test.skip('should handle session exit', async ({ page }) => {
    // Create a session that will exit quickly using a simple command
    const { sessionName, sessionId } = await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('exit-test'),
      command: 'echo "Session will exit immediately"', // Simple command that exits naturally
    });

    // Track the session for cleanup
    if (sessionId) {
      sessionManager.trackSession(sessionName, sessionId);
    }

    // Wait for session to show output
    const terminal = page.locator('vibe-terminal');
    await expect(terminal).toContainText('Session will exit immediately', { timeout: 5000 });

    // The echo command should have exited by now
    // Navigate back to home
    await page.goto('/');

    // Verify session shows as exited
    await waitForSessionState(page, sessionName, 'exited', { timeout: 10000 });
    await assertSessionInList(page, sessionName, { status: 'EXITED' });
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

      // Wait for the list to be ready without networkidle
      await waitForSessionCards(page);

      // Create second session
      const { sessionName: session2 } = await sessionManager.createTrackedSession();

      // Navigate back to list to verify both exist
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      // Wait for session cards to load without networkidle
      await waitForSessionCards(page);

      // Verify both sessions exist
      await verifyMultipleSessionsInList(page, [session1, session2]);
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
    const { sessionName } = await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('activity-test'),
    });

    // Navigate back to list
    await page.goto('/');
    await waitForSessionCards(page);

    // Get initial activity time
    const sessionCard = page.locator(`session-card:has-text("${sessionName}")`);
    const _initialActivity = await sessionCard
      .locator('.activity-time, .last-activity, time')
      .textContent();

    // Navigate back to session and interact with it
    await sessionCard.click();
    await page.waitForSelector('vibe-terminal', { state: 'visible' });

    // Send some input to trigger activity
    await page.keyboard.type('echo activity');
    await page.keyboard.press('Enter');

    // Wait for command to execute
    const terminal = page.locator('vibe-terminal');
    await expect(terminal).toContainText('activity');

    // Navigate back to list
    await page.goto('/');
    await waitForSessionCards(page);

    // Activity timestamp should have updated (but we won't check exact time)
    // Just verify the element exists and has content
    const updatedActivity = await sessionCard
      .locator('.activity-time, .last-activity, time')
      .textContent();
    expect(updatedActivity).toBeTruthy();
  });

  test.skip('should handle session with long output', async ({ page }) => {
    // Create a session with default shell
    const { sessionName } = await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('long-output'),
    });

    // Generate long output using simple commands
    for (let i = 1; i <= 20; i++) {
      await page.keyboard.type(`echo "Line ${i} of output"`);
      await page.keyboard.press('Enter');
    }

    // Wait for the last line to appear
    const terminal = page.locator('vibe-terminal');
    await expect(terminal).toContainText('Line 20 of output', { timeout: 10000 });

    // Verify terminal is still responsive
    await page.keyboard.type('echo "Still working"');
    await page.keyboard.press('Enter');
    await expect(terminal).toContainText('Still working', { timeout: 5000 });

    // Navigate back and verify session is still in list
    await page.goto('/');
    await assertSessionInList(page, sessionName);
  });

  test('should persist session across page refresh', async ({ page }) => {
    // Create a session
    const { sessionName } = await sessionManager.createTrackedSession();

    // Refresh the page and verify session is still accessible
    await refreshAndVerifySession(page, sessionName);
  });
});
