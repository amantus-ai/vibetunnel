import { test } from '../fixtures/test.fixture';
import { assertSessionInList } from '../helpers/assertion.helper';
import {
  createAndNavigateToSession,
  waitForSessionState,
} from '../helpers/session-lifecycle.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

test.describe('Session Persistence Tests', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });
  test('should create and find a long-running session', async ({ page }) => {
    // Create a session with a command that runs longer
    const { sessionName } = await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('long-running'),
      command: 'bash -c "sleep 30"', // Sleep for 30 seconds to keep session running
    });

    // Navigate back to home
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    // Verify session is visible and running
    await assertSessionInList(page, sessionName, { status: 'RUNNING' });
  });

  test('should handle session with error gracefully', async ({ page }) => {
    // Create a session with a command that will fail
    const { sessionName } = await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('error-test'),
      command: 'this-command-does-not-exist',
    });

    // Navigate back to home
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    // Wait for the session status to update to exited
    await waitForSessionState(page, sessionName, 'EXITED');

    // Verify it shows as exited
    await assertSessionInList(page, sessionName, { status: 'EXITED' });
  });
});
