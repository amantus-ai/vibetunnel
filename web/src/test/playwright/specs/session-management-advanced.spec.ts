import { expect, test } from '../fixtures/test.fixture';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

// These tests need to run in serial mode to avoid session state conflicts
test.describe.configure({ mode: 'serial' });

test.describe('Advanced Session Management', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);

    // Ensure we're on the home page at the start of each test
    try {
      if (!page.url().includes('localhost') || page.url().includes('/session/')) {
        await page.goto('/', { timeout: 10000 });
        await page.waitForLoadState('domcontentloaded');
      }
    } catch (_error) {
      console.log('Navigation error in beforeEach, attempting recovery...');
      // Try to recover by going to blank page first
      await page.goto('about:blank');
      await page.goto('/');
    }
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should kill individual sessions', async ({ page, sessionListPage }) => {
    // Create a tracked session with unique name
    const uniqueName = `kill-test-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const { sessionName } = await sessionManager.createTrackedSession(
      uniqueName,
      false,
      undefined // Use default shell command which stays active
    );

    // Go back to session list
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Check if we need to show exited sessions
    const showExitedCheckbox = page.locator('input[type="checkbox"][role="checkbox"]');
    const exitedSessionsHidden = await page
      .locator('text=/No running sessions/i')
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (exitedSessionsHidden) {
      // Check if checkbox exists and is not already checked
      const isChecked = await showExitedCheckbox.isChecked().catch(() => false);
      if (!isChecked) {
        // Click the checkbox to show exited sessions
        await showExitedCheckbox.click();
        await page.waitForTimeout(500); // Wait for UI update
      }
    }

    // Now wait for session cards to be visible
    await page.waitForSelector('session-card', { state: 'visible', timeout: 5000 });

    // Kill the session using page object
    await sessionListPage.killSession(sessionName);

    // Wait for the kill operation to complete - session should either disappear or show as exited
    await page.waitForFunction(
      (name) => {
        // Look for the session in all sections
        const cards = document.querySelectorAll('session-card');
        const sessionCard = Array.from(cards).find((card) => card.textContent?.includes(name));

        // If card not found, it was removed (killed successfully)
        if (!sessionCard) return true;

        // If found, check if it's in the exited state
        const cardText = sessionCard.textContent || '';
        return cardText.includes('exited');
      },
      sessionName,
      { timeout: 10000 }
    );

    // Verify the session is either gone or showing as exited
    const exitedCard = page.locator('session-card').filter({ hasText: sessionName });
    const isVisible = await exitedCard.isVisible({ timeout: 1000 }).catch(() => false);

    if (isVisible) {
      // If still visible, it should show as exited
      await expect(exitedCard).toContainText('exited');
    }
    // If not visible, that's also valid - session was cleaned up
  });

  test('should copy session information', async ({ page }) => {
    // Make sure we're starting from a clean state
    if (page.url().includes('/session/')) {
      await page.goto('/', { timeout: 10000 });
      await page.waitForLoadState('domcontentloaded');
    }

    // Create a tracked session
    await sessionManager.createTrackedSession();

    // Should see copy button for path
    await expect(page.locator('[title="Click to copy path"]')).toBeVisible();

    // Click to copy path
    await page.click('[title="Click to copy path"]');

    // Visual feedback would normally appear (toast notification)
    // We can't test clipboard content directly in Playwright

    // Verify the clickable-path component exists and has the right behavior
    const clickablePath = page.locator('clickable-path').first();
    await expect(clickablePath).toBeVisible();
  });

  test('should display session metadata correctly', async ({ page }) => {
    // Create a session with the default command
    const sessionName = sessionManager.generateSessionName('metadata-test');
    await sessionManager.createTrackedSession(sessionName, false, 'bash');

    // The session is created with default working directory (~)
    // Since we can't set a custom working directory without shell operators,
    // we'll just check the default behavior

    // Check that the path is displayed
    const pathElement = page.locator('[title="Click to copy path"]');
    await expect(pathElement).toBeVisible({ timeout: 10000 });

    // Check that we're in the session view
    await expect(page.locator('vibe-terminal')).toBeVisible({ timeout: 10000 });

    // The session should be active - be more specific to avoid strict mode violation
    await expect(page.locator('session-header').getByText(sessionName)).toBeVisible();
  });
});
