import { test } from '../fixtures/test.fixture';
import { assertSessionInList } from '../helpers/assertion.helper';
import {
  createAndNavigateToSession,
  waitForSessionState,
} from '../helpers/session-lifecycle.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

// These tests create their own sessions and can run in parallel
test.describe.configure({ mode: 'parallel' });

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
    const { sessionName, sessionId } = await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('long-running'),
      command: 'bash -c "sleep 30"', // Sleep for 30 seconds to keep session running
    });

    // Track the session for cleanup
    if (sessionId) {
      sessionManager.trackSession(sessionName, sessionId);
    }

    // Navigate back to home
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    // Verify session is visible and running
    await assertSessionInList(page, sessionName, { status: 'RUNNING' });
  });

  test.skip('should handle session with error gracefully', async ({ page }) => {
    // Create a session with a command that will fail immediately
    const { sessionName, sessionId } = await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('error-test'),
      command: 'sh -c "exit 1"', // Use sh instead of bash, exit immediately with error code
    });

    // Track the session for cleanup
    if (sessionId) {
      sessionManager.trackSession(sessionName, sessionId);
    }

    // Navigate back to home
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    // Add a small delay to allow session status to update
    await page.waitForTimeout(2000);

    // Wait for the session status to update to exited (give it more time as the command needs to fail)
    await waitForSessionState(page, sessionName, 'exited', { timeout: 30000 });

    // Verify it shows as exited
    await assertSessionInList(page, sessionName, { status: 'EXITED' });
  });
});
