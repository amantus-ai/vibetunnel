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
    await page.waitForLoadState('networkidle');

    // Add extra wait in CI for session list to fully load
    if (process.env.CI) {
      await page.waitForTimeout(3000);
    }

    // Wait for at least 2 session cards to be visible
    await page.waitForFunction(
      () => {
        const cards = document.querySelectorAll('session-card');
        return cards.length >= 2;
      },
      { timeout: process.env.CI ? 30000 : 15000 }
    );

    // Double-check the count
    const sessionCards = await page.locator('session-card').count();
    expect(sessionCards).toBeGreaterThanOrEqual(2);

    // Verify each session is in the list
    for (const session of sessions) {
      await assertSessionInList(page, session.sessionName);
    }
  });
});
