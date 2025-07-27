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

  test.skip('should kill individual sessions', async ({ page, sessionListPage }) => {
    // Create a tracked session with unique name
    const uniqueName = `kill-test-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const { sessionName } = await sessionManager.createTrackedSession(
      uniqueName,
      false,
      undefined // Use default shell command which stays active
    );

    // Go back to session list
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 10000 });

    // Wait for the page to be ready
    await page.waitForSelector('vibetunnel-app', { state: 'attached', timeout: 5000 });

    // Ensure all sessions are visible (including exited ones)
    const { ensureAllSessionsVisible } = await import('../helpers/ui-state.helper');
    await ensureAllSessionsVisible(page);

    // Now wait for session cards to be visible
    try {
      await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });
    } catch (_error) {
      // Debug: Check what's on the page
      const pageText = await page.textContent('body');
      console.log('Page text when no session cards found:', pageText?.substring(0, 500));
      throw new Error('No session cards visible after navigation');
    }

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
      // Log the card content for debugging
      const cardText = await exitedCard.textContent();
      console.log(`Session card for ${sessionName} text:`, cardText);

      // Check for various exit indicators
      const hasExitIndicator =
        cardText?.toLowerCase().includes('exited') ||
        cardText?.toLowerCase().includes('killed') ||
        cardText?.toLowerCase().includes('terminated') ||
        cardText?.toLowerCase().includes('stopped');

      if (!hasExitIndicator) {
        // Check if it has a specific status attribute
        const statusAttr = await exitedCard.getAttribute('data-status');
        console.log('Session card status attribute:', statusAttr);

        // Also check inner elements
        const statusElement = exitedCard.locator('[data-status="exited"]');
        const hasStatusElement = (await statusElement.count()) > 0;
        console.log('Has exited status element:', hasStatusElement);
      }

      // If still visible, it should show as exited (with longer timeout for CI)
      await expect(exitedCard).toContainText('exited', { timeout: 10000 });
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
