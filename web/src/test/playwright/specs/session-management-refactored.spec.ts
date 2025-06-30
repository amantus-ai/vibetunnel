import { expect, test } from '../fixtures/session-fixture';
import { assertSessionCount, assertSessionInList } from '../helpers/assertion.helper';
import { takeDebugScreenshot } from '../helpers/screenshot.helper';
import { waitForSessionState } from '../helpers/session-lifecycle.helper';

test.describe('Session Management (Optimized)', () => {
  test('should kill an active session', async ({ page, sessionManager }) => {
    // Create a tracked session using the fixture
    const { sessionName } = await sessionManager.createTrackedSession();

    // Navigate back to list
    await page.goto('/');

    // Kill the session using page object
    const { SessionListPage } = await import('../pages/session-list.page');
    const sessionListPage = new SessionListPage(page);
    await sessionListPage.killSession(sessionName);

    // Verify session state changed
    await waitForSessionState(page, sessionName, 'EXITED');
  });

  test('should display session metadata correctly', async ({ page, createAndNavigateToSession }) => {
    // Use the fixture helper to create and navigate
    const { sessionName } = await createAndNavigateToSession();
    
    // Navigate back to list
    await page.goto('/');

    // Verify session card displays correct information
    await assertSessionInList(page, sessionName, { status: 'RUNNING' });

    // Use modern locator with getByRole
    const sessionCard = page.getByRole('article').filter({ hasText: sessionName });
    await expect(sessionCard).toContainText(sessionName);
  });

  test('should handle concurrent sessions', async ({ page, apiClient, workerId }) => {
    try {
      // Create multiple sessions in parallel using batch operation
      const sessions = await apiClient.createSessionBatch(2, `${workerId}-concurrent`);

      // Navigate to list and verify both exist
      await page.goto('/');
      await assertSessionCount(page, 2, { operator: 'minimum' });
      
      for (const session of sessions) {
        await assertSessionInList(page, session.name);
      }
    } catch (error) {
      await takeDebugScreenshot(page, 'debug-concurrent-sessions');
      throw error;
    }
  });

  test('should persist session across page refresh', async ({ page, createAndNavigateToSession }) => {
    // Create a session using the fixture
    const { sessionName } = await createAndNavigateToSession();

    // Refresh the page
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Verify session still exists
    await page.goto('/');
    await assertSessionInList(page, sessionName);
  });

  test('should handle multiple session operations', async ({ page, apiClient, sessionManager }) => {
    // Create sessions in batch for faster execution
    const sessions = await apiClient.createSessionBatch(3, 'multi-op');
    
    // Navigate to list
    await page.goto('/');
    
    // Verify all sessions are visible
    await assertSessionCount(page, sessions.length, { operator: 'minimum' });
    
    // Delete one session via API for speed
    await apiClient.deleteSession(sessions[0].id);
    
    // Refresh and verify count
    await page.reload();
    await assertSessionCount(page, sessions.length - 1, { operator: 'minimum' });
  });
});