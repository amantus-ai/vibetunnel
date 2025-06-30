import { expect, test } from '../fixtures/test.fixture';
import {
  assertSessionInList,
  assertTerminalReady,
  assertUrlHasSession,
} from '../helpers/assertion.helper';
import {
  createAndNavigateToSession,
  createMultipleSessions,
} from '../helpers/session-lifecycle.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

test.describe('Basic Session Tests', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should create a new session', async ({ page }) => {
    // Create and navigate to session using helper
    const { sessionId } = await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('basic-test'),
    });

    // Verify navigation and terminal state
    await assertUrlHasSession(page, sessionId);
    await assertTerminalReady(page);
  });

  test('should list created sessions', async ({ page }) => {
    // Create a tracked session
    const { sessionName } = await sessionManager.createTrackedSession();

    // Go back to session list
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify session appears in list
    await assertSessionInList(page, sessionName);
  });

  test('should navigate between sessions', async ({ page }) => {
    // Create multiple sessions using helper
    const sessions = await createMultipleSessions(page, 2, {
      name: 'nav-test',
    });

    const firstSessionUrl = sessions[0].sessionId;
    const secondSessionUrl = sessions[1].sessionId;

    // Verify URLs are different
    expect(firstSessionUrl).not.toBe(secondSessionUrl);

    // Go back to session list
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Verify both sessions are visible
    await page.waitForSelector('session-card', { state: 'visible', timeout: 15000 });
    const sessionCards = await page.locator('session-card').count();
    expect(sessionCards).toBeGreaterThanOrEqual(2);

    // Verify each session is in the list
    for (const session of sessions) {
      await assertSessionInList(page, session.sessionName);
    }
  });
});
