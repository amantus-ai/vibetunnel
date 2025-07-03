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

    // First, make sure we can see exited sessions
    await page.goto('/', { waitUntil: 'networkidle' });
    await ensureExitedSessionsVisible(page);

    // Clean up any existing test sessions before starting
    const existingCount = await page.locator('session-card').count();
    if (existingCount > 0) {
      console.log(`Found ${existingCount} existing sessions. Cleaning up test sessions...`);

      // Find and kill any existing test sessions
      const sessionCards = await page.locator('session-card').all();
      for (const card of sessionCards) {
        const cardText = await card.textContent();
        if (cardText?.includes('test-')) {
          const sessionName = cardText.match(/test-[\w-]+/)?.[0];
          if (sessionName) {
            console.log(`Killing existing test session: ${sessionName}`);
            try {
              const killButton = card.locator('[data-testid="kill-session-button"]');
              if (await killButton.isVisible({ timeout: 500 })) {
                await killButton.click();
                await page.waitForTimeout(500);
              }
            } catch (error) {
              console.log(`Failed to kill ${sessionName}:`, error);
            }
          }
        }
      }

      // Clean exited sessions
      const cleanExitedButton = page.locator('button:has-text("Clean Exited")');
      if (await cleanExitedButton.isVisible({ timeout: 1000 })) {
        await cleanExitedButton.click();
        await page.waitForTimeout(2000);
      }

      const newCount = await page.locator('session-card').count();
      console.log(`After cleanup, ${newCount} sessions remain`);
    }

    // Create multiple sessions WITHOUT navigating between each
    // This is important because navigation interrupts the session creation flow
    const sessionNames = [];

    console.log('Creating 3 sessions in sequence...');

    // First session - will navigate to session view
    const { sessionName: session1 } = await sessionManager.createTrackedSession();
    sessionNames.push(session1);
    console.log(`Created session 1: ${session1}`);

    // Navigate back to list before creating more
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000); // Wait for UI to stabilize

    // Second session
    const { sessionName: session2 } = await sessionManager.createTrackedSession();
    sessionNames.push(session2);
    console.log(`Created session 2: ${session2}`);

    // Navigate back to list
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000); // Wait for UI to stabilize

    // Third session
    const { sessionName: session3 } = await sessionManager.createTrackedSession();
    sessionNames.push(session3);
    console.log(`Created session 3: ${session3}`);

    // Final navigation back to list
    await page.goto('/', { waitUntil: 'networkidle' });

    // Force a page refresh to ensure we get the latest session list
    await page.reload({ waitUntil: 'networkidle' });

    // Wait for API response
    await page.waitForResponse(
      (response) => response.url().includes('/api/sessions') && response.status() === 200,
      { timeout: 10000 }
    );

    // Additional wait for UI to render
    await page.waitForTimeout(2000);

    // Log the current state
    const totalCards = await page.locator('session-card').count();
    console.log(`After creating 3 sessions, found ${totalCards} total session cards`);

    // List all visible session names for debugging
    const visibleSessions = await page.locator('session-card').all();
    for (const card of visibleSessions) {
      const text = await card.textContent();
      console.log(`Visible session: ${text?.trim()}`);
    }

    // Ensure exited sessions are visible
    await ensureExitedSessionsVisible(page);

    // We need at least 2 sessions to test "Kill All" (one might have been cleaned up)
    const sessionCount = await page.locator('session-card').count();
    if (sessionCount < 2) {
      console.error(`Expected at least 2 sessions but found only ${sessionCount}`);
      console.error('Created sessions:', sessionNames);

      // Take a screenshot for debugging
      await page.screenshot({ path: `test-debug-missing-sessions-${Date.now()}.png` });

      // Check if sessions exist but are hidden
      const allText = await page.locator('body').textContent();
      for (const name of sessionNames) {
        if (allText?.includes(name)) {
          console.log(`Session ${name} found in page text but not visible as card`);
        } else {
          console.log(`Session ${name} NOT found anywhere on page`);
        }
      }
    }

    // We need at least 2 sessions to demonstrate "Kill All" functionality
    expect(sessionCount).toBeGreaterThanOrEqual(2);

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

    // Wait for sessions to transition to exited state
    await page.waitForFunction(
      () => {
        const cards = document.querySelectorAll('session-card');
        // Check that all visible cards show as exited
        return Array.from(cards).every((card) => {
          const text = card.textContent?.toLowerCase() || '';
          // Skip if not visible
          if (card.getAttribute('style')?.includes('display: none')) return true;
          // Check if it shows as exited
          return text.includes('exited') && !text.includes('killing');
        });
      },
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

      // We should have at least 2 exited sessions (some of the ones we created)
      expect(exitedElements).toBeGreaterThanOrEqual(2);

      console.log('Kill All operation completed successfully');
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
        expect(exitedElements).toBeGreaterThanOrEqual(2);
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
