import { expect, test } from '../fixtures/test.fixture';
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
    await page.goto('/');
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

    // After killing, wait for the session status to update
    await page
      .waitForFunction(
        () => {
          const cards = document.querySelectorAll('session-card');
          return Array.from(cards).some((card) =>
            card.textContent?.toLowerCase().includes('exited')
          );
        },
        { timeout: 2000 }
      )
      .catch(() => {});

    // Check if the "Show Exited" button appears (sessions are hidden by default)
    const showExitedButton = page
      .locator('button')
      .filter({ hasText: /Show Exited/i })
      .first();

    // Try to find the Show Exited button with a shorter timeout
    const showExitedVisible = await showExitedButton
      .isVisible({ timeout: 1000 })
      .catch(() => false);

    if (showExitedVisible) {
      // Click the Show Exited button if it's visible
      await showExitedButton.click();
      // Wait for the button text to change to "Hide Exited" to confirm the action
      await page.waitForFunction(
        () => {
          const buttons = Array.from(document.querySelectorAll('button'));
          return buttons.some((btn) => btn.textContent?.includes('Hide Exited'));
        },
        { timeout: 2000 }
      );

      // Now the exited session should be visible
      const exitedCard = page.locator('session-card').filter({ hasText: sessionName }).first();
      await expect(exitedCard).toBeVisible({ timeout: 2000 });

      // Verify it shows EXITED status
      await expect(exitedCard.locator('text=/exited/i').first()).toBeVisible({ timeout: 2000 });
    } else {
      // The Show Exited button didn't appear, which means either:
      // 1. The session is still visible as exited (exited sessions not hidden)
      // 2. Something went wrong with the kill operation

      // Check if the session card is still visible with exited status
      const exitedCard = page.locator('session-card').filter({ hasText: sessionName }).first();
      const isVisible = await exitedCard.isVisible({ timeout: 1000 }).catch(() => false);

      if (isVisible) {
        // Session is visible, verify it shows EXITED status
        await expect(exitedCard.locator('text=/exited/i').first()).toBeVisible({ timeout: 2000 });
      } else {
        // Session disappeared without Show Exited button - this is unexpected
        throw new Error('Session disappeared after killing but no Show Exited button appeared');
      }
    }
  });

  test('should kill all sessions at once', async ({ page }) => {
    test.setTimeout(30000); // Give more time for multiple session operations

    // With clean slate from fixture, we can proceed directly
    // Create multiple sessions
    const sessionNames = [];
    for (let i = 0; i < 3; i++) {
      await page.click('button[title="Create New Session"]');
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
      await page.goto('/');
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
    // First check if they're already hidden
    let sessionsHidden = true;
    for (const name of sessionNames) {
      const isVisible = await page
        .locator('session-card')
        .filter({ hasText: name })
        .isVisible()
        .catch(() => false);
      if (isVisible) {
        sessionsHidden = false;
        break;
      }
    }

    if (!sessionsHidden) {
      // Sessions are still visible, wait for them to exit
      await page.waitForFunction(
        (names) => {
          const cards = document.querySelectorAll('session-card');
          const ourSessions = Array.from(cards).filter((card) =>
            names.some((name) => card.textContent?.includes(name))
          );

          // Either hidden or all show as exited (not killing)
          return (
            ourSessions.length === 0 ||
            ourSessions.every((card) => {
              const text = card.textContent?.toLowerCase() || '';
              return text.includes('exited') && !text.includes('killing');
            })
          );
        },
        sessionNames,
        { timeout: 25000 }
      );
    }

    // Sessions should be hidden by default after killing
    // Click Show Exited to see them
    const showExitedButton = page
      .locator('button')
      .filter({ hasText: /Show Exited/i })
      .first();
    await expect(showExitedButton).toBeVisible({ timeout: 4000 });
    await showExitedButton.click();

    // Wait for exited sessions to become visible
    await page.waitForFunction(
      () => {
        const cards = document.querySelectorAll('session-card');
        return Array.from(cards).some((card) => card.textContent?.toLowerCase().includes('exited'));
      },
      { timeout: 2000 }
    );

    // Now verify all our sessions show as exited
    for (const name of sessionNames) {
      const sessionCard = page.locator('session-card').filter({ hasText: name }).first();
      await expect(sessionCard).toBeVisible({ timeout: 2000 });
      await expect(sessionCard.locator('text=/exited/i').first()).toBeVisible();
    }
  });

  test('should copy session information', async ({ page }) => {
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
    await expect(pidElement).toBeVisible();

    // Click to copy PID
    await pidElement.click();
  });

  test('should display session metadata correctly', async ({ page }) => {
    // Create a session with specific working directory
    await page.click('button[title="Create New Session"]');
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
    test.setTimeout(30000); // Give more time for multiple operations

    // Create 2 running sessions
    const runningSessionNames = [];
    for (let i = 0; i < 2; i++) {
      await page.click('button[title="Create New Session"]');
      await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

      const spawnWindowToggle = page.locator('button[role="switch"]');
      if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
        await spawnWindowToggle.click();
      }

      const sessionName = generateTestSessionName();
      runningSessionNames.push(sessionName);
      await page.fill('input[placeholder="My Session"]', sessionName);
      await page.locator('button').filter({ hasText: 'Create' }).first().click();
      await page.waitForURL(/\?session=/);

      // Go back to list
      await page.goto('/');
      await page.waitForSelector('session-card', { state: 'visible' });
    }

    // Create a session and kill it
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
      await spawnWindowToggle.click();
    }

    const exitedSessionName = generateTestSessionName();
    await page.fill('input[placeholder="My Session"]', exitedSessionName);
    await page.locator('button').filter({ hasText: 'Create' }).first().click();
    await page.waitForURL(/\?session=/);

    // Go back to list
    await page.goto('/');
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

    // By default, exited sessions should be hidden
    const exitedCard = page.locator('session-card').filter({ hasText: exitedSessionName }).first();
    const exitedVisible = await exitedCard.isVisible({ timeout: 500 }).catch(() => false);
    expect(exitedVisible).toBe(false);

    // Running sessions should still be visible
    for (const name of runningSessionNames) {
      await expect(page.locator('session-card').filter({ hasText: name })).toBeVisible();
    }

    // Find and click Show Exited button
    const showExitedButton = page
      .locator('button')
      .filter({ hasText: /Show Exited/i })
      .first();
    await expect(showExitedButton).toBeVisible({ timeout: 2000 });
    await showExitedButton.click();

    // Wait for exited sessions to become visible in the UI
    await page.waitForFunction(
      () => {
        const cards = document.querySelectorAll('session-card');
        return Array.from(cards).some((card) => card.textContent?.toLowerCase().includes('exited'));
      },
      { timeout: 2000 }
    );

    // Now the exited session should be visible
    await expect(page.locator('session-card').filter({ hasText: exitedSessionName })).toBeVisible();
    await expect(
      page.locator('session-card').filter({ hasText: exitedSessionName }).locator('text=/exited/i')
    ).toBeVisible();

    // And running sessions should still be visible
    for (const name of runningSessionNames) {
      await expect(page.locator('session-card').filter({ hasText: name })).toBeVisible();
    }

    // The button should now say "Hide Exited"
    const hideExitedButton = page
      .locator('button')
      .filter({ hasText: /Hide Exited/i })
      .first();
    await expect(hideExitedButton).toBeVisible({ timeout: 1000 });

    // Click to hide exited sessions again
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

    // Exited session should be hidden again
    const exitedHidden = await page
      .locator('session-card')
      .filter({ hasText: exitedSessionName })
      .isVisible({ timeout: 500 })
      .catch(() => false);
    expect(exitedHidden).toBe(false);

    // Running sessions should still be visible
    for (const name of runningSessionNames) {
      await expect(page.locator('session-card').filter({ hasText: name })).toBeVisible();
    }
  });
});
