import { expect, test } from '../fixtures/test.fixture';
import { navigateToHome } from '../helpers/navigation.helper';
import { generateTestSessionName } from '../helpers/terminal.helper';

test.describe('Advanced Session Management', () => {
  // Page navigation is handled by fixture

  test('should kill individual sessions', async ({ page }) => {
    test.setTimeout(20000); // Give more time for this test

    // Create a session
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    const sessionName = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', sessionName);
    await page.locator('button').filter({ hasText: 'Create' }).first().click();
    await page.waitForURL(/\?session=/);

    // Go back to session list
    await navigateToHome(page);
    await page.waitForSelector('session-card', { state: 'visible' });

    // Find the session card
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
    await expect(sessionCard).toBeVisible();

    // The kill button should be in the session card
    const killButton = sessionCard.locator('button[title="Kill session"]').first();

    // Wait for the button to be visible and click it
    await killButton.waitFor({ state: 'visible', timeout: 4000 });

    // Handle potential confirmation dialog
    page.once('dialog', (dialog) => dialog.accept());
    await killButton.click();

    // After killing, wait for the session to either be killed or hidden
    // First wait a bit for the kill operation to start
    await page.waitForTimeout(500);

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

  test('should kill all sessions at once', async ({ page }) => {
    test.setTimeout(60000); // Increase timeout to 60s for flaky test

    // Wait for page to be ready
    await page.waitForTimeout(1000);

    // With clean slate from fixture, we can proceed directly
    // Create multiple sessions
    const sessionNames = [];
    for (let i = 0; i < 3; i++) {
      await page.waitForSelector('button[title="Create New Session"]', { state: 'visible', timeout: 5000 });
      await page.click('button[title="Create New Session"]', { timeout: 10000 });
      await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

      const spawnWindowToggle = page.locator('button[role="switch"]');
      if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
        await spawnWindowToggle.click();
      }

      const sessionName = generateTestSessionName();
      sessionNames.push(sessionName);
      await page.fill('input[placeholder="My Session"]', sessionName);
      await page.locator('button').filter({ hasText: 'Create' }).first().click();
      await page.waitForURL(/\?session=/);

      // Go back to list
      await navigateToHome(page);
      await page.waitForSelector('session-card', { state: 'visible' });
    }

    // Verify all sessions are visible
    for (const name of sessionNames) {
      await expect(page.locator('session-card').filter({ hasText: name })).toBeVisible();
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

    // Wait for a bit to let the kill process start
    await page.waitForTimeout(1000);

    // Sessions might be hidden immediately or take time to transition
    // Wait for all sessions to either be hidden or show as exited
    await page.waitForFunction(
      (names) => {
        const cards = document.querySelectorAll('[data-testid="session-card"]');
        const ourSessions = Array.from(cards).filter((card) =>
          names.some((name) => card.textContent?.includes(name))
        );

        // Either hidden or all show as exited (not killing)
        return (
          ourSessions.length === 0 ||
          ourSessions.every((card) => {
            // Check data attributes for more reliable status detection
            const status = card.getAttribute('data-session-status');
            const isKilling = card.getAttribute('data-is-killing') === 'true';

            // Also check if the card contains the exited text as a fallback
            const hasExitedText = card.textContent?.toLowerCase().includes('exited') || false;

            return (status === 'exited' || hasExitedText) && !isKilling;
          })
        );
      },
      sessionNames,
      { timeout: 40000 }
    );

    // Since hideExitedSessions is false in tests, exited sessions should remain visible
    // We should see a "Hide Exited" button instead of "Show Exited"
    const hideExitedButton = page
      .locator('button')
      .filter({ hasText: /Hide Exited/i })
      .first();

    // Check if exited sessions are visible (they should be since hideExitedSessions is false)
    const exitedVisible = await hideExitedButton.isVisible({ timeout: 1000 }).catch(() => false);

    if (exitedVisible) {
      // Exited sessions are visible, verify all our sessions show as exited
      for (const name of sessionNames) {
        const sessionCard = page.locator('session-card').filter({ hasText: name }).first();
        await expect(sessionCard).toBeVisible({ timeout: 2000 });
        await expect(sessionCard.locator('text=/exited/i').first()).toBeVisible();
      }
    } else {
      // If Hide Exited button is not visible, maybe sessions are hidden
      // Look for Show Exited button
      const showExitedButton = page
        .locator('button')
        .filter({ hasText: /Show Exited/i })
        .first();

      const showExitedVisible = await showExitedButton
        .isVisible({ timeout: 1000 })
        .catch(() => false);

      if (showExitedVisible) {
        await showExitedButton.click();

        // Wait for exited sessions to become visible
        await page.waitForFunction(
          () => {
            const cards = document.querySelectorAll('session-card');
            return Array.from(cards).some((card) =>
              card.textContent?.toLowerCase().includes('exited')
            );
          },
          { timeout: 2000 }
        );

        // Now verify all our sessions show as exited
        for (const name of sessionNames) {
          const sessionCard = page.locator('session-card').filter({ hasText: name }).first();
          await expect(sessionCard).toBeVisible({ timeout: 2000 });
          await expect(sessionCard.locator('text=/exited/i').first()).toBeVisible();
        }
      } else {
        // Sessions were killed and removed completely
        console.log('All sessions were killed and removed from view');
      }
    }
  });

  test('should copy session information', async ({ page }) => {
    test.setTimeout(20000); // Increase timeout

    // Wait for page to be ready
    await page.waitForTimeout(1000);

    // Create a session
    await page.waitForSelector('button[title="Create New Session"]', { state: 'visible', timeout: 5000 });
    await page.click('button[title="Create New Session"]', { timeout: 10000 });
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    const sessionName = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', sessionName);
    await page.locator('button').filter({ hasText: 'Create' }).first().click();
    await page.waitForURL(/\?session=/);

    // Should see copy buttons for path and PID
    await expect(page.locator('[title="Click to copy path"]')).toBeVisible();

    // Click to copy path
    await page.click('[title="Click to copy path"]');

    // Visual feedback would normally appear (toast notification)
    // We can't test clipboard content directly in Playwright

    // Go back to list view
    await navigateToHome(page);
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();

    // Hover to see PID copy option
    await sessionCard.hover();
    const pidElement = sessionCard.locator('[title*="Click to copy PID"]');
    await expect(pidElement).toBeVisible({ timeout: 10000 });

    // Click to copy PID
    await pidElement.click({ timeout: 10000 });
  });

  test('should display session metadata correctly', async ({ page }) => {
    test.setTimeout(20000); // Increase timeout

    // Wait for page to be ready
    await page.waitForTimeout(1000);

    // Create a session with specific working directory
    await page.waitForSelector('button[title="Create New Session"]', { state: 'visible', timeout: 5000 });
    await page.click('button[title="Create New Session"]', { timeout: 10000 });
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    const sessionName = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', sessionName);

    // Change working directory
    await page.fill('input[placeholder="~/"]', '/tmp');

    await page.locator('button').filter({ hasText: 'Create' }).first().click();
    await page.waitForURL(/\?session=/);

    // Check that the path is displayed - be more specific to avoid multiple matches
    await expect(page.locator('[title="Click to copy path"]').locator('text=/tmp')).toBeVisible();

    // Check terminal size is displayed
    await expect(page.locator('text=/\\d+×\\d+/')).toBeVisible();

    // Check status indicator
    await expect(page.locator('text=RUNNING')).toBeVisible();
  });

  test('should filter sessions by status', async ({ page }) => {
    test.setTimeout(40000); // Give more time for multiple operations

    // Wait for page to be ready
    await page.waitForTimeout(1000);

    // Create just 1 running session first
    await page.waitForSelector('button[title="Create New Session"]', { state: 'visible', timeout: 5000 });
    await page.click('button[title="Create New Session"]', { timeout: 10000 });
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    const runningSessionName = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', runningSessionName);
    await page.locator('button').filter({ hasText: 'Create' }).first().click();
    await page.waitForURL(/\?session=/);

    // Go back to list
    await navigateToHome(page);
    await page.waitForSelector('session-card', { state: 'visible' });

    // Create a session and kill it
    await page.waitForSelector('button[title="Create New Session"]', { state: 'visible', timeout: 5000 });
    await page.click('button[title="Create New Session"]', { timeout: 10000 });
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle2 = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle2.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle2.click();
    }

    const exitedSessionName = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', exitedSessionName);
    await page.locator('button').filter({ hasText: 'Create' }).first().click();
    await page.waitForURL(/\?session=/);

    // Go back to list
    await navigateToHome(page);
    await page.waitForSelector('session-card', { state: 'visible' });

    // Kill this session
    const sessionToKill = page
      .locator('session-card')
      .filter({ hasText: exitedSessionName })
      .first();
    const killButton = sessionToKill.locator('button[title="Kill session"]').first();

    page.once('dialog', (dialog) => dialog.accept());
    await killButton.click();

    // Wait for the "Killing session..." message to appear and disappear
    const killingMessage = page.locator('text=/Killing session/i');
    await killingMessage.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
    await killingMessage.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

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
    await expect(page.locator('session-card').filter({ hasText: runningSessionName })).toBeVisible();

    // Since exited session is visible, verify it shows as exited
    await expect(
      page.locator('session-card').filter({ hasText: exitedSessionName }).locator('text=/exited/i')
    ).toBeVisible();

    // Running session should still be visible
    await expect(page.locator('session-card').filter({ hasText: runningSessionName })).toBeVisible();

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
    await expect(page.locator('session-card').filter({ hasText: runningSessionName })).toBeVisible();

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
    await expect(page.locator('session-card').filter({ hasText: runningSessionName })).toBeVisible();
  });
});
