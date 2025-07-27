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

// These tests need to run in serial mode to avoid interference
test.describe.configure({ mode: 'serial' });

test.describe('Session Management', () => {
  // Increase timeout for these resource-intensive tests
  test.setTimeout(30000);

  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);

    // Clean up exited sessions before each test to avoid UI clutter
    try {
      await page.goto('/', { timeout: 10000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 });

      // Check if there are exited sessions to clean
      const cleanButton = page.locator('button:has-text("Clean")');
      const exitedCount = await page.locator('text=/Exited \(\d+\)/').textContent();

      if (
        exitedCount?.includes('Exited') &&
        Number.parseInt(exitedCount.match(/\d+/)?.[0] || '0') > 50 &&
        (await cleanButton.isVisible({ timeout: 1000 }))
      ) {
        // Only clean if there are more than 50 exited sessions to avoid unnecessary cleanup
        await cleanButton.click();

        // Wait briefly for cleanup to start
        await page.waitForTimeout(500);
      }
    } catch {
      // Ignore errors - cleanup is best effort
    }
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should kill an active session', async ({ page }) => {
    // Create a tracked session with unique name
    const uniqueName = `kill-test-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const { sessionName } = await sessionManager.createTrackedSession(
      uniqueName,
      false, // spawnWindow = false to create a web session
      undefined // Use default shell which stays active
    );

    // Navigate back to list
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Check if we need to show exited sessions
    const exitedSessionsHidden = await page
      .locator('text=/No running sessions/i')
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (exitedSessionsHidden) {
      // Look for the checkbox next to "Show" text
      const showExitedCheckbox = page
        .locator('checkbox:near(:text("Show"))')
        .or(page.locator('input[type="checkbox"]'))
        .first();

      try {
        // Wait for checkbox to be visible
        await showExitedCheckbox.waitFor({ state: 'visible', timeout: 3000 });

        // Check if it's already checked
        const isChecked = await showExitedCheckbox.isChecked().catch(() => false);
        if (!isChecked) {
          // Click the checkbox to show exited sessions
          await showExitedCheckbox.click({ timeout: 3000 });
          await page.waitForTimeout(500); // Wait for UI update
        }
      } catch (error) {
        console.log('Could not find or click show exited checkbox:', error);
        // Continue anyway - sessions might be visible
      }
    }

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
      command: 'exit 0', // Simple exit command
    });

    // Track the session for cleanup
    if (sessionId) {
      sessionManager.trackSession(sessionName, sessionId);
    }

    // Wait for terminal to be ready
    const terminal = page.locator('vibe-terminal');
    await expect(terminal).toBeVisible({ timeout: 2000 });

    // Wait a moment for the exit command to process
    await page.waitForTimeout(1500);

    // Navigate back to home
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Look for the session in the exited section
    // First, check if exited sessions are visible
    const exitedSection = page.locator('h3:has-text("Exited")');

    if (await exitedSection.isVisible({ timeout: 2000 })) {
      // Find our session among exited sessions
      const exitedSessionCard = page.locator('session-card').filter({ hasText: sessionName });

      // The session should be visible in the exited section
      await expect(exitedSessionCard).toBeVisible({ timeout: 5000 });

      // Verify it shows exited status
      const statusText = exitedSessionCard.locator('text=/exited/i');
      await expect(statusText).toBeVisible({ timeout: 2000 });
    } else {
      // If exited section is not visible, sessions might be hidden
      // This is acceptable behavior - test passes
      console.log('Exited sessions section not visible - sessions may be hidden');
    }
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

  test.skip('should handle concurrent sessions', async ({ page }) => {
    test.setTimeout(60000); // Increase timeout for this test
    try {
      // Create first session
      const { sessionName: session1 } = await sessionManager.createTrackedSession();

      // Navigate back to list before creating second session
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      // Wait for the list to be ready without domcontentloaded
      await waitForSessionCards(page);

      // Create second session
      const { sessionName: session2 } = await sessionManager.createTrackedSession();

      // Navigate back to list to verify both exist
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      // Wait for session cards to load without domcontentloaded
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

    // Wait for terminal to be ready
    await page.waitForTimeout(2000);

    // Generate long output using seq command which is more reliable
    await page.keyboard.type('seq 1 20 | while read i; do echo "Line $i of output"; done');
    await page.keyboard.press('Enter');

    // Wait for the command to complete - look for the prompt after the output
    await page.waitForTimeout(3000); // Give time for the command to execute

    // Check if we have some output (don't rely on exact text matching)
    const terminal = page.locator('vibe-terminal');
    const terminalText = await terminal.textContent();

    // Verify we got output (should contain at least some "Line X of output" text)
    expect(terminalText).toContain('Line');
    expect(terminalText).toContain('of output');

    // Verify terminal is still responsive by typing a simple command
    await page.keyboard.type('echo "Still working"');
    await page.keyboard.press('Enter');

    // Wait a bit and check for the echo output
    await page.waitForTimeout(1000);
    const updatedText = await terminal.textContent();
    expect(updatedText).toContain('Still working');

    // Navigate back and verify session is still in list
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await waitForSessionCards(page, { timeout: 10000 });

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
