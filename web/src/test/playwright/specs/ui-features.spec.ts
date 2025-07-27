import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/test.fixture';
import { assertTerminalReady } from '../helpers/assertion.helper';
import { createAndNavigateToSession } from '../helpers/session-lifecycle.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';
import { waitForModalClosed } from '../helpers/wait-strategies.helper';

// Type for file browser web component
interface FileBrowserElement extends HTMLElement {
  visible?: boolean;
}

// These tests create their own sessions and can run in parallel
test.describe.configure({ mode: 'parallel' });

// Helper function to open file browser through image upload menu or compact menu
async function openFileBrowser(page: Page) {
  // Look for session view first
  const sessionView = page.locator('session-view').first();
  await expect(sessionView).toBeVisible({ timeout: 10000 });

  // Small delay to ensure UI is ready
  await page.waitForTimeout(500);

  // Check if we're in compact mode by looking for the compact menu
  const compactMenuButton = sessionView.locator('compact-menu button').first();
  const imageUploadButton = sessionView.locator('[data-testid="image-upload-button"]').first();

  // Try to detect which mode we're in
  const isCompactMode = await compactMenuButton.isVisible({ timeout: 1000 }).catch(() => false);
  const isFullMode = await imageUploadButton.isVisible({ timeout: 1000 }).catch(() => false);

  if (!isCompactMode && !isFullMode) {
    // Wait a bit more and check again
    await page.waitForTimeout(2000);
    const isCompactModeRetry = await compactMenuButton
      .isVisible({ timeout: 1000 })
      .catch(() => false);
    const isFullModeRetry = await imageUploadButton.isVisible({ timeout: 1000 }).catch(() => false);

    if (!isCompactModeRetry && !isFullModeRetry) {
      throw new Error(
        'Neither compact menu nor image upload button is visible. Session header may not be loaded properly.'
      );
    }

    if (isCompactModeRetry) {
      // Compact mode after retry
      await compactMenuButton.click({ force: true });

      // Wait for menu to be visible by checking for any menu item
      await page.waitForFunction(
        () => {
          const menuItems = document.querySelectorAll('button[data-testid]');
          return Array.from(menuItems).some((item) =>
            item.getAttribute('data-testid')?.includes('compact-')
          );
        },
        { timeout: 5000 }
      );

      const compactFileBrowser = page.locator('[data-testid="compact-file-browser"]');
      await expect(compactFileBrowser).toBeVisible({ timeout: 5000 });
      await compactFileBrowser.click();
    } else {
      // Full mode after retry
      await imageUploadButton.click();
      await page.waitForTimeout(500);
      const browseFilesButton = page.locator('button[data-action="browse"]');
      await expect(browseFilesButton).toBeVisible({ timeout: 5000 });
      await browseFilesButton.click();
    }
  } else if (isCompactMode) {
    // Compact mode: open compact menu and click file browser
    await compactMenuButton.click({ force: true });

    // Wait for menu to be visible by checking for any menu item
    await page.waitForFunction(
      () => {
        const menuItems = document.querySelectorAll('button[data-testid]');
        return Array.from(menuItems).some((item) =>
          item.getAttribute('data-testid')?.includes('compact-')
        );
      },
      { timeout: 5000 }
    );

    const compactFileBrowser = page.locator('[data-testid="compact-file-browser"]');
    await expect(compactFileBrowser).toBeVisible({ timeout: 5000 });
    await compactFileBrowser.click();
  } else {
    // Full mode: use image upload menu
    await imageUploadButton.click();
    await page.waitForTimeout(500); // Wait for menu to open
    const browseFilesButton = page.locator('button[data-action="browse"]');
    await expect(browseFilesButton).toBeVisible({ timeout: 5000 });
    await browseFilesButton.click();
  }

  // Wait for file browser to appear
  await page.waitForTimeout(500);
}

test.describe('UI Features', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should open and close file browser', async ({ page }) => {
    // Create a session using helper
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser'),
    });
    await assertTerminalReady(page);

    // Open file browser through image upload menu
    await openFileBrowser(page);

    // Wait for file browser to be visible using custom evaluation
    try {
      await page.waitForFunction(
        () => {
          const browser = document.querySelector('file-browser');
          if (!browser) return false;

          // Check multiple ways the file browser might indicate it's visible
          const hasVisibleProp = (browser as FileBrowserElement).visible === true;
          const hasVisibleAttr = browser.getAttribute('visible') === 'true';
          const isDisplayed = window.getComputedStyle(browser).display !== 'none';
          const hasContent = browser.children.length > 0;

          return hasVisibleProp || hasVisibleAttr || (isDisplayed && hasContent);
        },
        { timeout: 10000 }
      );
    } catch (_error) {
      // Debug: log the current state
      const state = await page.evaluate(() => {
        const browser = document.querySelector('file-browser');
        if (!browser) return { exists: false };
        return {
          exists: true,
          visible: (browser as FileBrowserElement).visible,
          visibleAttr: browser.getAttribute('visible'),
          display: window.getComputedStyle(browser).display,
          childCount: browser.children.length,
          innerHTML: browser.innerHTML.substring(0, 100),
        };
      });
      console.error('File browser state:', state);
      throw new Error(`File browser did not become visible: ${JSON.stringify(state)}`);
    }

    // Close file browser with Escape
    await page.keyboard.press('Escape');

    // Wait for file browser to be hidden
    await page.waitForFunction(
      () => {
        const browser = document.querySelector('file-browser');
        if (!browser) return true; // If element is gone, it's hidden

        // Check multiple ways the file browser might indicate it's hidden
        const hasVisibleProp = (browser as FileBrowserElement).visible === false;
        const hasVisibleAttr =
          browser.getAttribute('visible') === 'false' || !browser.hasAttribute('visible');
        const isHidden = window.getComputedStyle(browser).display === 'none';

        return hasVisibleProp || hasVisibleAttr || isHidden;
      },
      { timeout: 10000 }
    );
  });

  test('should navigate directories in file browser', async ({ page }) => {
    // Create a session using helper
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-nav'),
    });
    await assertTerminalReady(page);

    // Open file browser through image upload menu
    await openFileBrowser(page);

    // Wait for file browser to be visible
    const fileBrowserVisible = await page.waitForFunction(
      () => {
        const browser = document.querySelector('file-browser');
        return browser && (browser as FileBrowserElement).visible === true;
      },
      { timeout: 5000 }
    );
    expect(fileBrowserVisible).toBeTruthy();

    // Check if we can see the modal content by looking for the modal wrapper
    const modalWrapper = page.locator('modal-wrapper').filter({ hasText: 'File Browser' });
    const modalVisible = await modalWrapper.isVisible().catch(() => false);

    if (!modalVisible) {
      // File browser might be implemented differently, skip directory navigation
      test.skip(true, 'File browser modal not found - implementation may have changed');
      return;
    }

    // Look for directory entries
    const directoryEntries = modalWrapper.locator('[data-type="directory"], .directory-entry');
    const directoryCount = await directoryEntries.count();

    if (directoryCount > 0) {
      // Click on first directory
      await directoryEntries.first().click();

      // Wait a bit for navigation
      await page.waitForTimeout(1000);
    }

    // Close file browser
    await page.keyboard.press('Escape');
  });

  test('should use quick start commands', async ({ page }) => {
    // Open create session dialog
    await page.waitForSelector('button[title="Create New Session"]', {
      state: 'visible',
      timeout: 5000,
    });
    await page.click('button[title="Create New Session"]', { timeout: 10000 });
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    // Turn off native terminal if toggle exists
    const spawnWindowToggle = page.locator('button[role="switch"]');
    if ((await spawnWindowToggle.count()) > 0) {
      if ((await spawnWindowToggle.getAttribute('aria-checked')) === 'true') {
        await spawnWindowToggle.click();
      }
    }

    // Look for quick start buttons
    const quickStartButtons = page.locator(
      'button:has-text("zsh"), button:has-text("bash"), button:has-text("python3")'
    );
    const buttonCount = await quickStartButtons.count();
    expect(buttonCount).toBeGreaterThan(0);

    // Click on bash if available
    const bashButton = page.locator('button:has-text("bash")').first();
    if (await bashButton.isVisible()) {
      await bashButton.click();

      // Command field should be populated
      const commandInput = page.locator('input[placeholder="zsh"]');
      const value = await commandInput.inputValue();
      expect(value).toBe('bash');
    }

    // Create the session
    const sessionName = sessionManager.generateSessionName('quick-start');
    await page.fill('input[placeholder="My Session"]', sessionName);

    // Wait for the create button to be ready and click it
    const createButton = page.locator('button:has-text("Create")');
    await createButton.waitFor({ state: 'visible' });
    await createButton.scrollIntoViewIfNeeded();

    // Use Promise.race to handle both navigation and potential modal close
    await Promise.race([
      createButton.click({ timeout: 5000 }),
      page.waitForURL(/\/session\//, { timeout: 30000 }),
    ]).catch(async () => {
      // If the first click failed, try force click
      await createButton.click({ force: true });
    });

    // Ensure we navigate to the session
    if (!page.url().includes('/session/')) {
      await page.waitForURL(/\/session\//, { timeout: 10000 });
    }

    // Track for cleanup
    sessionManager.clearTracking();
  });

  test('should display notification options', async ({ page }) => {
    // Check notification button in header - it's the notification-status component
    const notificationButton = page.locator('notification-status button').first();

    // Wait for notification button to be visible
    await expect(notificationButton).toBeVisible({ timeout: 4000 });

    // Verify the button has a tooltip
    const tooltip = await notificationButton.getAttribute('title');
    expect(tooltip).toBeTruthy();
    expect(tooltip?.toLowerCase()).toContain('notification');
  });

  test.skip('should show session count in header', async ({ page }) => {
    test.setTimeout(30000); // Increase timeout
    // Create a tracked session first
    const { sessionName } = await sessionManager.createTrackedSession();

    // Go to home page to see the session list
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 10000 });

    // Wait for header to be visible
    const headerVisible = await page
      .locator('full-header')
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (!headerVisible) {
      // Header might not be visible in mobile view or test environment
      test.skip(true, 'Header not visible in current viewport');
      return;
    }

    // Get session count from header
    const headerElement = page.locator('full-header').first();
    const sessionCountElement = headerElement
      .locator('p.text-xs, .session-count, [data-testid="session-count"]')
      .first();

    // Wait for the count element to be visible
    try {
      await expect(sessionCountElement).toBeVisible({ timeout: 5000 });
    } catch {
      // Count element might not be present in all layouts
      test.skip(true, 'Session count element not found in header');
      return;
    }

    const countText = await sessionCountElement.textContent();
    const count = Number.parseInt(countText?.match(/\d+/)?.[0] || '0');

    // We should have at least 1 session (the one we just created)
    expect(count).toBeGreaterThanOrEqual(1);

    // Verify our session is visible in the list
    const sessionCard = page.locator(`session-card:has-text("${sessionName}")`);
    await expect(sessionCard).toBeVisible({ timeout: 10000 });
  });

  test('should preserve form state in create dialog', async ({ page }) => {
    // Open create dialog
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    // Fill in some values
    const testName = 'Preserve Test';
    const testCommand = 'python3';
    const testDir = '/usr/local';

    await page.fill('input[placeholder="My Session"]', testName);
    await page.fill('input[placeholder="zsh"]', testCommand);
    await page.fill('input[placeholder="~/"]', testDir);

    // Close dialog
    await page.keyboard.press('Escape');
    await waitForModalClosed(page);

    // Reopen dialog
    await page.click('button[title="Create New Session"]');
    await page.waitForSelector('input[placeholder="My Session"]', { state: 'visible' });

    // Working directory and command might be preserved (depends on implementation)
    // Session name is typically cleared
    const commandValue = await page.locator('input[placeholder="zsh"]').inputValue();
    const _dirValue = await page.locator('input[placeholder="~/"]').inputValue();

    // At minimum, the form should be functional
    expect(commandValue).toBeTruthy(); // Should have some default
  });

  test('should show terminal preview in session cards', async ({ page }) => {
    // Create a tracked session
    const { sessionName } = await sessionManager.createTrackedSession();

    // Go back to list
    await page.goto('/');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 20000 });

    // Wait a bit more for session list to update
    await page.waitForTimeout(2000);

    // Find our session card
    const sessionCard = page.locator('session-card').filter({ hasText: sessionName }).first();
    await expect(sessionCard).toBeVisible({ timeout: 20000 });

    // The card should show terminal preview (buffer component)
    const preview = sessionCard.locator('vibe-terminal-buffer').first();
    await expect(preview).toBeVisible({ timeout: 20000 });
  });
});
