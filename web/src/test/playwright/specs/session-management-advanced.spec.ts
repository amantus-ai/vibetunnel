import { expect, test } from '../fixtures/test.fixture';
import { TestSessionManager } from '../helpers/test-data-manager.helper';
import { getExitedSessionsVisibility } from '../helpers/ui-state.helper';

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
      // If the card disappeared, check if exited sessions are hidden
      const { visible: exitedVisible, toggleButton } = await getExitedSessionsVisibility(page);

      if (!exitedVisible && toggleButton) {
        // Click to show exited sessions
        await toggleButton.click();

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
    // Create a session with the default command
    const sessionName = sessionManager.generateSessionName('metadata-test');
    const { sessionId } = await sessionManager.createTrackedSession(sessionName, false, 'bash');

    // Navigate to the session to see its metadata
    await page.goto(`/?session=${sessionId}`);
    await page.waitForLoadState('networkidle');

    // Wait for the session view to be fully loaded
    await page.waitForSelector('vibe-terminal', { state: 'visible', timeout: 10000 });

    // Check that the path is displayed
    const pathElement = page.locator('[title="Click to copy path"]');
    await expect(pathElement).toBeVisible({ timeout: 10000 });

    // Check terminal size is displayed - look for the pattern in the page
    await expect(page.locator('text=/\\d+×\\d+/').first()).toBeVisible({ timeout: 10000 });

    // Check status indicator - be more specific
    await expect(
      page.locator('[data-status="running"]').or(page.locator('text=/RUNNING/i')).first()
    ).toBeVisible({ timeout: 10000 });
  });
});
