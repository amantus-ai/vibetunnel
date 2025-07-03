import { expect, test } from '../fixtures/test.fixture';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

// These tests work with individual sessions and can run in parallel
test.describe.configure({ mode: 'parallel' });

test.describe('Advanced Session Management', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should kill individual sessions', async ({ page, sessionListPage }) => {
    // Create a tracked session
    const { sessionName } = await sessionManager.createTrackedSession();

    // Go back to session list
    await page.goto('/');

    // Kill the session using page object
    await sessionListPage.killSession(sessionName);

    // After killing, wait for the session to either be killed or hidden
    // Wait for the kill request to complete
    await page
      .waitForResponse(
        (response) => response.url().includes(`/api/sessions/`) && response.url().includes('/kill'),
        { timeout: 5000 }
      )
      .catch(() => {});

    // The session might be immediately hidden after killing or still showing as killing
    await page
      .waitForFunction(
        (name) => {
          const cards = document.querySelectorAll('session-card');
          const sessionCard = Array.from(cards).find((card) => card.textContent?.includes(name));

          // If the card is not found, it was likely hidden after being killed
          if (!sessionCard) return true;

          // If found, check data attributes for status
          const status = sessionCard.getAttribute('data-session-status');
          const isKilling = sessionCard.getAttribute('data-is-killing') === 'true';
          return status === 'exited' || !isKilling;
        },
        sessionName,
        { timeout: 10000 } // Increase timeout as kill operation can take time
      )
      .catch(() => {});

    // Since hideExitedSessions is set to false in the test fixture,
    // exited sessions should remain visible after being killed
    const exitedCard = page.locator('session-card').filter({ hasText: sessionName }).first();

    // Wait for the session card to either disappear or show as exited
    const cardExists = await exitedCard.isVisible({ timeout: 1000 }).catch(() => false);

    if (cardExists) {
      // Card is still visible, it should show as exited
      await expect(exitedCard.locator('text=/exited/i').first()).toBeVisible({ timeout: 5000 });
    } else {
      // If the card disappeared, check if there's a "Show Exited" button
      const showExitedButton = page
        .locator('button')
        .filter({ hasText: /Show Exited/i })
        .first();

      const showExitedVisible = await showExitedButton
        .isVisible({ timeout: 1000 })
        .catch(() => false);

      if (showExitedVisible) {
        // Click to show exited sessions
        await showExitedButton.click();

        // Wait for the exited session to appear
        await expect(page.locator('session-card').filter({ hasText: sessionName })).toBeVisible({
          timeout: 2000,
        });

        // Verify it shows EXITED status
        const exitedCardAfterShow = page
          .locator('session-card')
          .filter({ hasText: sessionName })
          .first();
        await expect(exitedCardAfterShow.locator('text=/exited/i').first()).toBeVisible({
          timeout: 2000,
        });
      } else {
        // Session was killed successfully and immediately removed from view
        // This is also a valid outcome
        console.log(`Session ${sessionName} was killed and removed from view`);
      }
    }
  });

  test('should copy session information', async ({ page }) => {
    // Create a tracked session
    const { sessionName } = await sessionManager.createTrackedSession();

    // Should see copy buttons for path and PID
    await expect(page.locator('[title="Click to copy path"]')).toBeVisible();

    // Click to copy path
    await page.click('[title="Click to copy path"]');

    // Visual feedback would normally appear (toast notification)
    // We can't test clipboard content directly in Playwright

    // Go back to list view
    await page.goto('/');
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();

    // Hover to see PID copy option
    await sessionCard.hover();
    const pidElement = sessionCard.locator('[title*="Click to copy PID"]');
    await expect(pidElement).toBeVisible({ timeout: 10000 });

    // Click to copy PID
    await pidElement.click({ timeout: 10000 });
  });

  test('should display session metadata correctly', async ({ page }) => {
    // Create a session with specific working directory using page object
    await page.waitForSelector('button[title="Create New Session"]', {
      state: 'visible',
      timeout: 5000,
    });
    await page.click('button[title="Create New Session"]', { timeout: 10000 });
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    const sessionName = sessionManager.generateSessionName('metadata-test');
    await page.fill('input[placeholder="My Session"]', sessionName);

    // Change working directory
    await page.fill('input[placeholder="~/"]', '/tmp');

    // Use bash for consistency in tests
    await page.fill('input[placeholder="zsh"]', 'bash');

    // Wait for session creation response
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/sessions') && response.request().method() === 'POST',
      { timeout: 10000 }
    );

    // Use force click to bypass pointer-events issues
    await page.locator('button').filter({ hasText: 'Create' }).first().click({ force: true });

    try {
      const response = await responsePromise;
      const responseBody = await response.json();
      const sessionId = responseBody.sessionId;

      // Wait for modal to close
      await page
        .waitForSelector('.modal-content', { state: 'hidden', timeout: 5000 })
        .catch(() => {});

      // Navigate manually if needed
      const currentUrl = page.url();
      if (!currentUrl.includes('?session=')) {
        await page.goto(`/?session=${sessionId}`, { waitUntil: 'domcontentloaded' });
      }
    } catch (_error) {
      // If response handling fails, still try to wait for navigation
      await page.waitForURL(/\?session=/, { timeout: 10000 });
    }

    // Track for cleanup
    sessionManager.clearTracking();

    // Check that the path is displayed - be more specific to avoid multiple matches
    await expect(page.locator('[title="Click to copy path"]').locator('text=/tmp')).toBeVisible({
      timeout: 10000,
    });

    // Check terminal size is displayed - look for the pattern in the page
    await expect(page.locator('text=/\\d+×\\d+/').first()).toBeVisible({ timeout: 10000 });

    // Check status indicator - be more specific
    await expect(
      page.locator('[data-status="running"]').or(page.locator('text=/RUNNING/i')).first()
    ).toBeVisible({ timeout: 10000 });
  });
});
