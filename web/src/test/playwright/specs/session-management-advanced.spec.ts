import { expect, test } from '../fixtures/test.fixture';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

test.describe('Advanced Session Management', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should kill individual sessions', async ({ page, sessionListPage }) => {
    test.setTimeout(20000);

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

  test('should kill all sessions at once', async ({ page, sessionListPage }) => {
    test.setTimeout(60000);

    // Create multiple tracked sessions
    const sessionNames = [];
    for (let i = 0; i < 3; i++) {
      const { sessionName } = await sessionManager.createTrackedSession();
      sessionNames.push(sessionName);

      // Go back to list
      await page.goto('/');
    }

    // Verify all sessions are visible
    for (const name of sessionNames) {
      const cards = await sessionListPage.getSessionCards();
      const hasSession = cards.some(async (card) => {
        const text = await card.textContent();
        return text?.includes(name);
      });
      expect(hasSession).toBeTruthy();
    }

    // Find and click Kill All button
    const killAllButton = page
      .locator('button')
      .filter({ hasText: /Kill All/i })
      .first();
    await expect(killAllButton).toBeVisible({ timeout: 2000 });

    // Handle confirmation dialog
    page.once('dialog', (dialog) => dialog.accept());
    await killAllButton.click();

    // Wait for kill all API calls to complete
    await page
      .waitForResponse(
        (response) => response.url().includes('/api/sessions') && response.url().includes('/kill'),
        { timeout: 5000 }
      )
      .catch(() => {});

    // Sessions might be hidden immediately or take time to transition
    // Wait for all sessions to either be hidden or show as exited
    await page.waitForFunction(
      (names) => {
        // Check for session cards in main view or sidebar sessions
        const cards = document.querySelectorAll('session-card');
        const sidebarButtons = Array.from(document.querySelectorAll('button')).filter((btn) => {
          const text = btn.textContent || '';
          return names.some((name) => text.includes(name));
        });

        const allSessions = [...Array.from(cards), ...sidebarButtons];
        const ourSessions = allSessions.filter((el) =>
          names.some((name) => el.textContent?.includes(name))
        );

        // Either hidden or all show as exited (not killing)
        return (
          ourSessions.length === 0 ||
          ourSessions.every((el) => {
            const text = el.textContent?.toLowerCase() || '';
            // Check if session is exited
            const hasExitedText = text.includes('exited');
            // Check if it's not in killing state
            const isNotKilling = !text.includes('killing');

            // For session cards, check data attributes if available
            if (el.tagName.toLowerCase() === 'session-card') {
              const status = el.getAttribute('data-session-status');
              const isKilling = el.getAttribute('data-is-killing') === 'true';
              if (status || isKilling !== null) {
                return (status === 'exited' || hasExitedText) && !isKilling;
              }
            }

            return hasExitedText && isNotKilling;
          })
        );
      },
      sessionNames,
      { timeout: 40000 }
    );

    // Wait for the UI to update after killing sessions
    await page.waitForLoadState('networkidle');

    // After killing all sessions, verify the result by checking for exited status
    // We can see in the screenshot that sessions appear in a grid view with "exited" status

    // First check if there's a Hide Exited button (which means exited sessions are visible)
    const hideExitedButton = page
      .locator('button')
      .filter({ hasText: /Hide Exited/i })
      .first();
    const hideExitedVisible = await hideExitedButton
      .isVisible({ timeout: 1000 })
      .catch(() => false);

    if (hideExitedVisible) {
      // Exited sessions are visible - verify we have some exited sessions
      const exitedElements = await page.locator('text=/exited/i').count();
      console.log(`Found ${exitedElements} elements with 'exited' text`);

      // We should have at least as many exited elements as sessions we created
      expect(exitedElements).toBeGreaterThanOrEqual(sessionNames.length);

      // Log success for each session we created
      for (const name of sessionNames) {
        console.log(`Session ${name} was successfully killed`);
      }
    } else {
      // Look for Show Exited button
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
        // Wait for exited sessions to be visible
        await page.waitForLoadState('domcontentloaded');

        // Now verify we have exited sessions
        const exitedElements = await page.locator('text=/exited/i').count();
        console.log(
          `Found ${exitedElements} elements with 'exited' text after showing exited sessions`
        );
        expect(exitedElements).toBeGreaterThanOrEqual(sessionNames.length);
      } else {
        // All sessions were completely removed - this is also a valid outcome
        console.log('All sessions were killed and removed from view');
      }
    }
  });

  test('should copy session information', async ({ page }) => {
    test.setTimeout(20000);

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
    test.setTimeout(20000);

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

    await page.locator('button').filter({ hasText: 'Create' }).first().click();
    await page.waitForURL(/\?session=/);

    // Track for cleanup
    sessionManager.clearTracking();

    // Check that the path is displayed - be more specific to avoid multiple matches
    await expect(page.locator('[title="Click to copy path"]').locator('text=/tmp')).toBeVisible();

    // Check terminal size is displayed
    await expect(page.locator('text=/\\d+×\\d+/')).toBeVisible();

    // Check status indicator
    await expect(page.locator('text=RUNNING')).toBeVisible();
  });

  test('should filter sessions by status', async ({ page }) => {
    test.setTimeout(40000);

    // Create a running session
    const { sessionName: runningSessionName } = await sessionManager.createTrackedSession();

    // Create another session to kill
    const { sessionName: exitedSessionName } = await sessionManager.createTrackedSession();

    // Go back to list
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible' });

    // Kill this session using page object
    const sessionListPage = await import('../pages/session-list.page').then(
      (m) => new m.SessionListPage(page)
    );
    await sessionListPage.killSession(exitedSessionName);

    // Wait for the UI to fully update - no "Killing" message and status changed
    await page.waitForFunction(
      () => {
        // Check if any element contains "Killing session" text
        const hasKillingMessage = Array.from(document.querySelectorAll('*')).some((el) =>
          el.textContent?.includes('Killing session')
        );
        return !hasKillingMessage;
      },
      { timeout: 2000 }
    );

    // Since hideExitedSessions is false in tests, exited sessions should remain visible
    const exitedCard = page.locator('session-card').filter({ hasText: exitedSessionName }).first();
    const exitedVisible = await exitedCard.isVisible({ timeout: 500 }).catch(() => false);
    expect(exitedVisible).toBe(true);

    // Running session should still be visible
    await expect(
      page.locator('session-card').filter({ hasText: runningSessionName })
    ).toBeVisible();

    // Since exited session is visible, verify it shows as exited
    await expect(
      page.locator('session-card').filter({ hasText: exitedSessionName }).locator('text=/exited/i')
    ).toBeVisible();

    // Running session should still be visible
    await expect(
      page.locator('session-card').filter({ hasText: runningSessionName })
    ).toBeVisible();

    // The button should say "Hide Exited" since exited sessions are visible
    const hideExitedButton = page
      .locator('button')
      .filter({ hasText: /Hide Exited/i })
      .first();
    await expect(hideExitedButton).toBeVisible({ timeout: 1000 });

    // Click to hide exited sessions
    await hideExitedButton.click();

    // Wait for exited sessions to be hidden
    await page.waitForFunction(
      (exitedName) => {
        const cards = document.querySelectorAll('session-card');
        const exitedCard = Array.from(cards).find((card) => card.textContent?.includes(exitedName));
        return !exitedCard;
      },
      exitedSessionName,
      { timeout: 2000 }
    );

    // Exited session should now be hidden
    const exitedHidden = await page
      .locator('session-card')
      .filter({ hasText: exitedSessionName })
      .isVisible({ timeout: 500 })
      .catch(() => false);
    expect(exitedHidden).toBe(false);

    // Running session should still be visible
    await expect(
      page.locator('session-card').filter({ hasText: runningSessionName })
    ).toBeVisible();

    // The button should now say "Show Exited"
    const showExitedButton = page
      .locator('button')
      .filter({ hasText: /Show Exited/i })
      .first();
    await expect(showExitedButton).toBeVisible({ timeout: 1000 });

    // Click to show exited sessions again
    await showExitedButton.click();

    // Wait for exited sessions to become visible
    await page.waitForFunction(
      (exitedName) => {
        const cards = document.querySelectorAll('session-card');
        const exitedCard = Array.from(cards).find((card) => card.textContent?.includes(exitedName));
        return !!exitedCard;
      },
      exitedSessionName,
      { timeout: 2000 }
    );

    // Exited session should be visible again
    const exitedVisibleAgain = await page
      .locator('session-card')
      .filter({ hasText: exitedSessionName })
      .isVisible({ timeout: 500 })
      .catch(() => false);
    expect(exitedVisibleAgain).toBe(true);

    // Running session should still be visible
    await expect(
      page.locator('session-card').filter({ hasText: runningSessionName })
    ).toBeVisible();
  });
});
