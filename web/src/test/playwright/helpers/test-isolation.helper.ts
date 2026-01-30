import type { Page } from '@playwright/test';

/**
 * Ensures test isolation by clearing state and navigating to a clean page
 */
export async function ensureCleanState(page: Page): Promise<void> {
  // If we're on a session page, navigate to root first
  if (page.url().includes('/session/')) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');
  }

  // Clear any open modals
  await closeAllModals(page);

  // Clear any error messages
  await dismissAllErrors(page);

  // Ensure the page is ready
  await waitForAppReady(page);
}

/**
 * Closes all open modals on the page
 */
export async function closeAllModals(page: Page): Promise<void> {
  const modalSelectors = ['.modal-content', '[role="dialog"]', '.modal-positioned'];

  for (const selector of modalSelectors) {
    try {
      const modal = page.locator(selector).first();
      if (await modal.isVisible({ timeout: 500 })) {
        // Try Escape key first
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);

        // If still visible, try close button
        if (await modal.isVisible({ timeout: 500 })) {
          const closeButton = page
            .locator('button[aria-label="Close modal"]')
            .or(page.locator('button:has-text("Cancel")'))
            .or(page.locator('.modal-content button:has(svg)'))
            .first();

          if (await closeButton.isVisible({ timeout: 200 })) {
            await closeButton.click({ force: true });
          }
        }

        // Wait for modal to disappear
        await page.waitForSelector(selector, { state: 'hidden', timeout: 2000 }).catch(() => {});
      }
    } catch (_error) {
      // Modal might not exist or already closed
    }
  }
}

/**
 * Dismisses all error messages and toasts
 */
export async function dismissAllErrors(page: Page): Promise<void> {
  const errorSelectors = ['.bg-status-error', '[role="alert"]', '.toast-error'];

  for (const selector of errorSelectors) {
    try {
      const errors = page.locator(selector);
      const count = await errors.count();

      for (let i = 0; i < count; i++) {
        const error = errors.nth(i);
        if (await error.isVisible({ timeout: 200 })) {
          await error.click({ force: true }).catch(() => {});
        }
      }
    } catch (_error) {
      // Errors might not exist
    }
  }
}

/**
 * Waits for the app to be ready
 */
export async function waitForAppReady(page: Page): Promise<void> {
  // Wait for app to be attached
  await page.waitForSelector('vibetunnel-app', { state: 'attached', timeout: 5000 });

  // Wait for create button to be visible (indicates app is ready)
  const createButton = page
    .locator('[data-testid="create-session-button"]')
    .or(page.locator('button[title="Create New Session"]'))
    .or(page.locator('button[title="Create New Session (⌘K)"]'))
    .first();

  await createButton.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
    // If create button is not visible, we might be in a different state
    // Just ensure the app is loaded
  });
}

/**
 * Ensures we're on the session list page
 */
export async function navigateToSessionList(page: Page): Promise<void> {
  if (!page.url().endsWith('/')) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');
  }

  await waitForAppReady(page);
  await closeAllModals(page);
}

/**
 * Ensures session cleanup between tests
 */
export async function cleanupTestSessions(page: Page, sessionPrefix = 'test-'): Promise<void> {
  await navigateToSessionList(page);

  try {
    // Wait for session cards to load
    await page.waitForSelector('session-card', { state: 'visible', timeout: 2000 });

    // Find all test sessions
    const testSessions = page.locator(`session-card:has-text("${sessionPrefix}")`);
    const count = await testSessions.count();

    if (count > 0) {
      console.log(`Found ${count} test sessions to cleanup`);

      // NEVER use Kill All button as it would kill ALL sessions including
      // the VibeTunnel session that Claude Code is running in!
      // Always clean up test sessions individually
      for (let i = 0; i < count; i++) {
        const session = testSessions.nth(0); // Always get first as they get removed
        const sessionName = await session.locator('.text-sm').first().textContent();

        // Double-check this is a test session before killing
        if (sessionName?.toLowerCase().includes(sessionPrefix.toLowerCase())) {
          const killButton = session.locator('[data-testid="kill-session-button"]');

          if (await killButton.isVisible({ timeout: 500 })) {
            await killButton.click();
            await page.waitForTimeout(500);
          }
        }
      }
    }
  } catch (error) {
    console.log('No sessions to cleanup or cleanup failed:', error);
  }
}
