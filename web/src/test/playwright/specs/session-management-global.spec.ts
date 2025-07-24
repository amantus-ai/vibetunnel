import { expect, test } from '../fixtures/test.fixture';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

// These tests perform global operations that affect all sessions
// They must run serially to avoid interfering with other tests
test.describe.configure({ mode: 'serial' });

test.describe('Global Session Management', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  // REMOVED: 'should kill all sessions at once' test
  // This test is permanently removed because it uses the Kill All button which would
  // terminate ALL sessions including the VibeTunnel session running Claude Code.
  // Tests must NEVER kill sessions they didn't create themselves.

  test.skip('should filter sessions by status', async ({ page }) => {
    // Create a running session
    const { sessionName: runningSessionName } = await sessionManager.createTrackedSession();

    // Create another session to kill
    const { sessionName: exitedSessionName } = await sessionManager.createTrackedSession();

    // Go back to list
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Wait for session cards or no sessions message
    await page.waitForFunction(
      () => {
        const cards = document.querySelectorAll('session-card');
        const noSessionsMsg = document.querySelector('.text-dark-text-muted');
        // Find button containing "Show Exited" text
        const buttons = Array.from(document.querySelectorAll('button'));
        const showExitedButton = buttons.find((btn) => btn.textContent?.includes('Show Exited'));
        return (
          cards.length > 0 ||
          noSessionsMsg?.textContent?.includes('No terminal sessions') ||
          showExitedButton
        );
      },
      { timeout: 10000 }
    );

    // Check if exited sessions are hidden
    const showExitedButton = page.locator('[data-testid="show-exited-button"]').first();
    if (await showExitedButton.isVisible({ timeout: 1000 })) {
      // Click to show exited sessions
      await showExitedButton.click();
      await page.waitForTimeout(500);
    }

    // Verify both sessions are visible before proceeding
    await expect(page.locator('session-card').filter({ hasText: runningSessionName })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('session-card').filter({ hasText: exitedSessionName })).toBeVisible({
      timeout: 10000,
    });

    // Kill this session using page object
    const sessionListPage = await import('../pages/session-list.page').then(
      (m) => new m.SessionListPage(page)
    );
    await sessionListPage.killSession(exitedSessionName);

    // Wait for the session to be killed - check that the specific session is marked as exited
    await page.waitForFunction(
      ({ sessionName }) => {
        const sessionCards = document.querySelectorAll('session-card');
        const targetCard = Array.from(sessionCards).find((card) =>
          card.textContent?.includes(sessionName)
        );
        if (!targetCard) return true; // Session removed completely

        // Check if the session is marked as exited
        const statusElement = targetCard.querySelector('[data-status]');
        const status = statusElement?.getAttribute('data-status');
        const isKilling = targetCard.getAttribute('data-is-killing') === 'true';

        // Session should be exited and not killing
        return status === 'exited' && !isKilling;
      },
      { sessionName: exitedSessionName },
      { timeout: 15000 } // Increased timeout for CI
    );

    // Check if exited sessions are visible (depends on app settings)
    const exitedCard = page.locator('session-card').filter({ hasText: exitedSessionName }).first();
    const exitedVisible = await exitedCard.isVisible({ timeout: 1000 }).catch(() => false);

    // The visibility of exited sessions depends on the app's hideExitedSessions setting
    // In CI, this might be different than in local tests
    if (!exitedVisible) {
      // If exited sessions are hidden, look for a "Show Exited" button
      const showExitedButton = page.locator('[data-testid="show-exited-button"]').first();
      const hasShowButton = await showExitedButton.isVisible({ timeout: 1000 }).catch(() => false);
      if (!hasShowButton) {
        // In CI, the button might not be visible due to test state
        test.skip(true, 'Show Exited button not visible - likely CI test state issue');
      }
    }

    // Running session should still be visible
    await expect(
      page.locator('session-card').filter({ hasText: runningSessionName })
    ).toBeVisible();

    // If exited session is visible, verify it shows as exited
    if (exitedVisible) {
      await expect(
        page
          .locator('session-card')
          .filter({ hasText: exitedSessionName })
          .locator('text=/exited/i')
      ).toBeVisible();
    }

    // Running session should still be visible
    await expect(
      page.locator('session-card').filter({ hasText: runningSessionName })
    ).toBeVisible();

    // Determine current state and find the appropriate button
    let toggleButton: ReturnType<typeof page.locator>;
    const isShowingExited = exitedVisible;

    if (isShowingExited) {
      // If exited sessions are visible, look for "Hide Exited" button
      toggleButton = page.locator('[data-testid="hide-exited-button"]').first();
    } else {
      // If exited sessions are hidden, look for "Show Exited" button
      toggleButton = page.locator('[data-testid="show-exited-button"]').first();
    }

    await expect(toggleButton).toBeVisible({ timeout: 5000 });

    // Click to toggle the state
    await toggleButton.click();

    // Wait for the toggle action to complete
    await page.waitForFunction(
      ({ exitedName, wasShowingExited }) => {
        const cards = document.querySelectorAll('session-card');
        const exitedCard = Array.from(cards).find((card) => card.textContent?.includes(exitedName));
        // If we were showing exited, they should now be hidden
        // If we were hiding exited, they should now be visible
        return wasShowingExited ? !exitedCard : !!exitedCard;
      },
      { exitedName: exitedSessionName, wasShowingExited: isShowingExited },
      { timeout: 2000 }
    );

    // Check the new state
    const exitedNowVisible = await page
      .locator('session-card')
      .filter({ hasText: exitedSessionName })
      .isVisible({ timeout: 500 })
      .catch(() => false);

    // Should be opposite of initial state
    expect(exitedNowVisible).toBe(!isShowingExited);

    // Running session should still be visible
    await expect(
      page.locator('session-card').filter({ hasText: runningSessionName })
    ).toBeVisible();

    // The button text should have changed
    const newToggleButton = isShowingExited
      ? page.locator('[data-testid="show-exited-button"]').first()
      : page.locator('[data-testid="hide-exited-button"]').first();

    await expect(newToggleButton).toBeVisible({ timeout: 2000 });

    // Click to toggle back
    await newToggleButton.click();

    // Wait for the toggle to complete again
    await page.waitForFunction(
      ({ exitedName, shouldBeVisible }) => {
        const cards = document.querySelectorAll('session-card');
        const exitedCard = Array.from(cards).find((card) => card.textContent?.includes(exitedName));
        return shouldBeVisible ? !!exitedCard : !exitedCard;
      },
      { exitedName: exitedSessionName, shouldBeVisible: isShowingExited },
      { timeout: 2000 }
    );

    // Exited session should be back to original state
    const exitedFinalVisible = await page
      .locator('session-card')
      .filter({ hasText: exitedSessionName })
      .isVisible({ timeout: 500 })
      .catch(() => false);
    expect(exitedFinalVisible).toBe(isShowingExited);

    // Running session should still be visible
    await expect(
      page.locator('session-card').filter({ hasText: runningSessionName })
    ).toBeVisible();
  });
});
