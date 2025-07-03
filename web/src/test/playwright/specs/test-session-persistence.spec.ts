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
    test.setTimeout(30000); // Increase timeout
    // Create a session with a command that runs longer
    const { sessionName, sessionId } = await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('long-running'),
      command: 'sleep 60', // Keep session running without shell operators
    });

    // Track the session for cleanup
    if (sessionId) {
      sessionManager.trackSession(sessionName, sessionId);
    }

    // Navigate back to home
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    // Verify session is visible in the list
    await assertSessionInList(page, sessionName);
  });

  test('should handle session with error gracefully', async ({ page }) => {
    // Create a session with a command that will fail immediately
    const { sessionName, sessionId } = await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('error-test'),
      command: 'false', // Simple command that returns non-zero exit code
    });

    // Track the session for cleanup
    if (sessionId) {
      sessionManager.trackSession(sessionName, sessionId);
    }

    // Wait a moment for the false command to execute and exit
    await page.waitForTimeout(1000);

    // The false command should exit immediately
    // Navigate back to home
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    // Find and scroll to the session card
    const sessionCard = page.locator(`session-card:has-text("${sessionName}")`);
    await sessionCard.waitFor({ state: 'attached', timeout: 10000 });
    await sessionCard.scrollIntoViewIfNeeded();

    // Wait for session to appear and status to update to exited
    await waitForSessionState(page, sessionName, 'exited', { timeout: 15000 });

    // Verify it shows as exited
    await assertSessionInList(page, sessionName, { status: 'EXITED' });
  });
});
