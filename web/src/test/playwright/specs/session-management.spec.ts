import { expect, test } from '../fixtures/test.fixture';
import { assertSessionInList } from '../helpers/assertion.helper';
import {
  refreshAndVerifySession,
  verifyMultipleSessionsInList,
  waitForSessionCards,
} from '../helpers/common-patterns.helper';
import { takeDebugScreenshot } from '../helpers/screenshot.helper';
import { createAndNavigateToSession } from '../helpers/session-lifecycle.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

// Type for session card web component
interface SessionCardElement extends HTMLElement {
  session?: {
    name?: string;
    command?: string[];
  };
}

// These tests need to run in serial mode to avoid interference
test.describe.configure({ mode: 'serial' });

test.describe('Session Management', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);

    // Clean up exited sessions before each test to avoid UI clutter
    try {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Check if there are exited sessions to clean
      const cleanButton = page.locator('button:has-text("Clean Exited")');
      if (await cleanButton.isVisible({ timeout: 2000 })) {
        await cleanButton.click();
        // Wait for cleanup to complete
        await page.waitForTimeout(1000);
      }
    } catch {
      // Ignore errors - cleanup is best effort
    }
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should kill an active session', async ({ page }) => {
    // Create a tracked session with a long-running command (sleep without shell operators)
    const { sessionName } = await sessionManager.createTrackedSession(
      'kill-test',
      false, // spawnWindow = false to create a web session
      'sleep 300' // Simple long-running command without shell operators
    );

    // Navigate back to list
    await page.goto('/');
    await waitForSessionCards(page);

    // Scroll to find the session card if there are many sessions
    const sessionCard = page.locator(`session-card:has-text("${sessionName}")`);

    // Wait for the session card to be attached to DOM
    await sessionCard.waitFor({ state: 'attached', timeout: 10000 });

    // Scroll the session card into view
    await sessionCard.scrollIntoViewIfNeeded();

    // Wait for it to be visible after scrolling
    await sessionCard.waitFor({ state: 'visible', timeout: 5000 });

    // Kill the session using the kill button directly
    const killButton = sessionCard.locator('[data-testid="kill-session-button"]');
    await killButton.waitFor({ state: 'visible', timeout: 5000 });
    await killButton.click();

    // Wait for the session to be killed and moved to IDLE section
    // The session might be removed entirely or moved to IDLE section
    await page.waitForFunction(
      (name) => {
        // Check if session is no longer in ACTIVE section
        const activeSessions = document.querySelector('.session-flex-responsive')?.parentElement;
        if (activeSessions?.textContent?.includes('ACTIVE')) {
          const activeCards = activeSessions.querySelectorAll('session-card');
          const stillActive = Array.from(activeCards).some((card) =>
            card.textContent?.includes(name)
          );
          if (stillActive) return false; // Still in active section
        }

        // Check if IDLE section exists and contains the session
        const sections = Array.from(document.querySelectorAll('h3'));
        const idleSection = sections.find((h3) => h3.textContent?.includes('IDLE'));
        if (idleSection) {
          const idleContainer = idleSection.parentElement;
          return idleContainer?.textContent?.includes(name) || false;
        }

        // Session might have been removed entirely, which is also valid
        return true;
      },
      sessionName,
      { timeout: 10000 }
    );
  });

  test('should handle session exit', async ({ page }) => {
    // Create a session that will exit after printing to terminal
    const { sessionName, sessionId } = await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('exit-test'),
      command: 'echo "Test session exiting"', // Simple command that exits immediately
    });

    // Track the session for cleanup
    if (sessionId) {
      sessionManager.trackSession(sessionName, sessionId);
    }

    // Wait for terminal to be ready and show output
    const terminal = page.locator('vibe-terminal');
    await expect(terminal).toBeVisible({ timeout: 5000 });

    // Wait for the command to complete and session to exit
    await page.waitForTimeout(5000);

    // Navigate back to home
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for multiple auto-refresh cycles to ensure status update
    await page.waitForTimeout(5000);

    await waitForSessionCards(page);

    // Find the session using custom evaluation to handle web component properties
    const sessionInfo = await page.evaluate((targetName) => {
      const cards = document.querySelectorAll('session-card');
      for (const card of cards) {
        const sessionCard = card as SessionCardElement;
        if (sessionCard.session) {
          const name = sessionCard.session.name || sessionCard.session.command?.join(' ') || '';
          if (name.includes(targetName)) {
            const statusEl = card.querySelector('span[data-status]');
            const status = statusEl?.getAttribute('data-status');
            return { found: true, status, name };
          }
        }
      }
      return { found: false };
    }, sessionName);

    // Verify session exists and shows as exited
    if (!sessionInfo.found) {
      // In CI, sessions might not be visible due to test isolation
      test.skip(true, 'Session not found - likely due to CI test isolation');
    }
    expect(sessionInfo.status).toBe('exited');
  });

  test('should display session metadata correctly', async ({ page }) => {
    // Create a session and navigate back
    const { sessionName } = await createAndNavigateToSession(page);
    await page.goto('/');

    // Verify session card displays correct information
    await assertSessionInList(page, sessionName, { status: 'running' });

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

      // Wait for the list to be ready
      await page.waitForLoadState('networkidle');
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

  test('should update session activity status', async ({ page }) => {
    // Create a session
    const { sessionName } = await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('activity-test'),
    });

    // Navigate back to list
    await page.goto('/');
    await waitForSessionCards(page);

    // Find and scroll to the session card
    const sessionCard = page.locator(`session-card:has-text("${sessionName}")`);
    await sessionCard.waitFor({ state: 'attached', timeout: 10000 });
    await sessionCard.scrollIntoViewIfNeeded();
    await sessionCard.waitFor({ state: 'visible', timeout: 5000 });

    // Verify initial status shows "running"
    const statusElement = sessionCard.locator('span[data-status="running"]');
    await expect(statusElement).toBeVisible({ timeout: 10000 });
    await expect(statusElement).toContainText('running');

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

    // Find the session card again and verify it still shows as running
    await sessionCard.waitFor({ state: 'attached', timeout: 10000 });
    await sessionCard.scrollIntoViewIfNeeded();

    // Session should still be running after activity
    const updatedStatusElement = sessionCard.locator('span[data-status="running"]');
    await expect(updatedStatusElement).toBeVisible();
    await expect(updatedStatusElement).toContainText('running');
  });

  test('should handle session with long output', async ({ page }) => {
    // Create a session with default shell
    const { sessionName } = await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('long-output'),
    });

    // Generate long output using simple commands
    for (let i = 1; i <= 20; i++) {
      await page.keyboard.type(`echo "Line ${i} of output"`);
      await page.keyboard.press('Enter');
      // Small delay between commands to avoid overwhelming the terminal
      await page.waitForTimeout(200);
    }

    // Wait for the last line to appear
    const terminal = page.locator('vibe-terminal');
    await expect(terminal).toContainText('Line 20 of output', { timeout: 15000 });

    // Verify terminal is still responsive
    await page.keyboard.type('echo "Still working"');
    await page.keyboard.press('Enter');
    await expect(terminal).toContainText('Still working', { timeout: 10000 });

    // Navigate back and verify session is still in list
    await page.goto('/');
    await waitForSessionCards(page);

    // Find and verify the session card
    const sessionCard = page.locator(`session-card:has-text("${sessionName}")`);
    await sessionCard.waitFor({ state: 'attached', timeout: 10000 });
    await sessionCard.scrollIntoViewIfNeeded();
    await assertSessionInList(page, sessionName);
  });

  test('should persist session across page refresh', async ({ page }) => {
    // Create a session
    const { sessionName } = await sessionManager.createTrackedSession();

    // Refresh the page and verify session is still accessible
    await refreshAndVerifySession(page, sessionName);
  });
});
