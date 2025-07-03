import { TIMEOUTS } from '../constants/timeouts';
import { expect, test } from '../fixtures/test.fixture';
import { TestSessionManager } from '../helpers/test-data-manager.helper';
import {
  ensureExitedSessionsVisible,
  getExitedSessionsVisibility,
} from '../helpers/ui-state.helper';

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

  test('should kill all sessions at once', async ({ page, sessionListPage }) => {
    // Increase timeout for this test as it involves multiple sessions
    test.setTimeout(TIMEOUTS.KILL_ALL_OPERATION * 3); // 90 seconds
    // Create multiple tracked sessions
    const sessionNames = [];
    for (let i = 0; i < 3; i++) {
      const { sessionName } = await sessionManager.createTrackedSession();
      sessionNames.push(sessionName);
      console.log(`Created session ${i + 1}: ${sessionName}`);

      // Go back to list after each creation
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      // Give server time to save session info
      await page.waitForTimeout(500);

      // Wait for session cards to be loaded or empty state
      await page.waitForSelector('session-card, .text-dark-text-muted', {
        state: 'visible',
        timeout: TIMEOUTS.SESSION_CREATION,
      });

      // Wait for the session to appear in the list with better error handling
      try {
        await page.waitForFunction(
          (name) => {
            const cards = document.querySelectorAll('session-card');
            const foundSession = Array.from(cards).some((card) => {
              const text = card.textContent || '';
              return text.includes(name);
            });
            if (!foundSession) {
              console.log(`Session ${name} not found yet. Found ${cards.length} cards`);
              // Log the text content of all cards for debugging
              Array.from(cards).forEach((card, index) => {
                console.log(`Card ${index}: ${card.textContent?.substring(0, 50)}...`);
              });
            }
            return foundSession;
          },
          sessionName,
          { timeout: 20000 } // Increase timeout significantly for CI
        );
        console.log(`Successfully found session ${sessionName} in the list`);
      } catch (error) {
        // Log current state for debugging
        const cardCount = await page.locator('session-card').count();
        const pageContent = await page.locator('body').textContent();
        console.error(`Failed to find session ${sessionName}. Total cards: ${cardCount}`);
        console.error(`Page contains: ${pageContent?.substring(0, 200)}...`);

        // Take a screenshot for debugging
        await page.screenshot({ path: `test-debug-session-not-found-${sessionName}.png` });
        throw error;
      }
    }

    // Ensure exited sessions are visible
    await ensureExitedSessionsVisible(page);

    // Wait for sessions to be visible (they may be running or exited)
    await page.waitForFunction(
      (names) => {
        const cards = document.querySelectorAll('session-card');
        return names.every((name) =>
          Array.from(cards).some((card) => card.textContent?.includes(name))
        );
      },
      sessionNames,
      { timeout: TIMEOUTS.SESSION_TRANSITION }
    );

    // Verify all sessions are visible (either running or exited)
    for (const name of sessionNames) {
      await expect(async () => {
        // Look for sessions in session-card elements first
        const cards = await sessionListPage.getSessionCards();
        let hasSession = false;
        for (const card of cards) {
          const text = await card.textContent();
          if (text?.includes(name)) {
            hasSession = true;
            break;
          }
        }

        // If not found in session cards, look for session name anywhere on the page
        if (!hasSession) {
          const sessionNameElement = await page.locator(`text=${name}`).first();
          hasSession = await sessionNameElement.isVisible().catch(() => false);
        }

        expect(hasSession).toBeTruthy();
      }).toPass({ timeout: 10000 });
    }

    // Find and click Kill All button
    const killAllButton = page
      .locator('button')
      .filter({ hasText: /Kill All/i })
      .first();
    await expect(killAllButton).toBeVisible({ timeout: 2000 });

    // Handle confirmation dialog if it appears
    const [dialog] = await Promise.all([
      page.waitForEvent('dialog', { timeout: 1000 }).catch(() => null),
      killAllButton.click(),
    ]);

    if (dialog) {
      await dialog.accept();
    }

    // Wait for kill all API calls to complete - wait for at least one kill response
    try {
      await page.waitForResponse(
        (response) => response.url().includes('/api/sessions') && response.url().includes('/kill'),
        { timeout: 5000 }
      );
    } catch {
      // Continue even if no kill response detected
    }

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
      { timeout: 30000 }
    );

    // Wait for the UI to update after killing sessions
    await page.waitForLoadState('networkidle');

    // After killing all sessions, verify the result by checking for exited status
    // We can see in the screenshot that sessions appear in a grid view with "exited" status

    // Check if exited sessions are visible after killing
    const { visible: exitedVisible } = await getExitedSessionsVisibility(page);

    if (exitedVisible) {
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

  test.skip('should filter sessions by status', async ({ page }) => {
    // Create a running session
    const { sessionName: runningSessionName } = await sessionManager.createTrackedSession();

    // Create another session to kill
    const { sessionName: exitedSessionName } = await sessionManager.createTrackedSession();

    // Go back to list
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait for session cards or no sessions message
    await page.waitForFunction(
      () => {
        const cards = document.querySelectorAll('session-card');
        const noSessionsMsg = document.querySelector('.text-dark-text-muted');
        return cards.length > 0 || noSessionsMsg?.textContent?.includes('No terminal sessions');
      },
      { timeout: 10000 }
    );

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

    // Check if exited sessions are visible (depends on app settings)
    const exitedCard = page.locator('session-card').filter({ hasText: exitedSessionName }).first();
    const exitedVisible = await exitedCard.isVisible({ timeout: 1000 }).catch(() => false);

    // The visibility of exited sessions depends on the app's hideExitedSessions setting
    // In CI, this might be different than in local tests
    if (!exitedVisible) {
      // If exited sessions are hidden, look for a "Show Exited" button
      const showExitedButton = page
        .locator('button')
        .filter({ hasText: /Show Exited/i })
        .first();
      const hasShowButton = await showExitedButton.isVisible({ timeout: 1000 }).catch(() => false);
      expect(hasShowButton).toBe(true);
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
      toggleButton = page
        .locator('button')
        .filter({ hasText: /Hide Exited/i })
        .first();
    } else {
      // If exited sessions are hidden, look for "Show Exited" button
      toggleButton = page
        .locator('button')
        .filter({ hasText: /Show Exited/i })
        .first();
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
      ? page
          .locator('button')
          .filter({ hasText: /Show Exited/i })
          .first()
      : page
          .locator('button')
          .filter({ hasText: /Hide Exited/i })
          .first();

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
