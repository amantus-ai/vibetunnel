import { expect, test } from '../fixtures/test.fixture';
import {
  assertSessionInList,
  assertTerminalReady,
  assertUrlHasSession,
} from '../helpers/assertion.helper';
import {
  createAndNavigateToSession,
  reconnectToSession,
} from '../helpers/session-lifecycle.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';
import { waitForElementStable } from '../helpers/wait-strategies.helper';

// These tests create their own sessions and can run in parallel
test.describe.configure({ mode: 'parallel' });

test.describe('Session Creation', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should create a new session with default name', async ({ page }) => {
    // One line to create and navigate to session
    const { sessionId } = await createAndNavigateToSession(page);

    // Simple assertions using helpers
    await assertUrlHasSession(page, sessionId);
    await assertTerminalReady(page);
  });

  test('should create a new session with custom name', async ({ page }) => {
    const customName = sessionManager.generateSessionName('custom');

    // Create session with custom name
    const { sessionName } = await createAndNavigateToSession(page, { name: customName });

    // Verify session is created with correct name
    await assertUrlHasSession(page);
    await waitForElementStable(page, 'session-header');

    // Check header shows custom name
    const sessionInHeader = page.locator('session-header').locator(`text="${sessionName}"`);
    await expect(sessionInHeader).toBeVisible();
  });

  test('should show created session in session list', async ({ page }) => {
    // Create tracked session
    const { sessionName } = await sessionManager.createTrackedSession();

    // Navigate back and verify
    await page.goto('/');
    await assertSessionInList(page, sessionName, { status: 'RUNNING' });
  });

  test('should handle multiple session creation', async ({ page }) => {
    // Create multiple tracked sessions
    const sessions: Array<{ sessionName: string; sessionId: string }> = [];

    for (let i = 0; i < 2; i++) {
      const { sessionName, sessionId } = await sessionManager.createTrackedSession(
        sessionManager.generateSessionName(`multi-test-${i + 1}`)
      );
      sessions.push({ sessionName, sessionId });

      // Navigate back to list for next creation (except last one)
      if (i < 1) {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
      }
    }

    // Navigate to list and verify all exist
    await page.goto('/');

    for (const session of sessions) {
      await assertSessionInList(page, session.sessionName);
    }
  });

  test('should reconnect to existing session', async ({ page }) => {
    // Create and track session
    const { sessionName } = await sessionManager.createTrackedSession();
    await assertTerminalReady(page);

    // Navigate away and back
    await page.goto('/');
    await reconnectToSession(page, sessionName);

    // Verify reconnected
    await assertUrlHasSession(page);
    await assertTerminalReady(page);
  });
});
