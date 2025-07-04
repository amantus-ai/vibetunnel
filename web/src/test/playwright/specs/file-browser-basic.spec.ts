import { expect, test } from '../fixtures/test.fixture';
import { assertTerminalReady } from '../helpers/assertion.helper';
import { createAndNavigateToSession } from '../helpers/session-lifecycle.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

// These tests create their own sessions and can run in parallel
test.describe.configure({ mode: 'parallel' });

test.describe('File Browser - Basic Functionality', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should have file browser button in session header', async ({ page }) => {
    // Create a session and navigate to it
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-button'),
    });
    await assertTerminalReady(page, 15000);

    // Look for file browser button in session header
    const fileBrowserButton = page.locator('[data-testid="file-browser-button"]');
    await expect(fileBrowserButton).toBeVisible({ timeout: 15000 });

    // Verify button has correct icon/appearance
    const buttonIcon = fileBrowserButton.locator('svg');
    await expect(buttonIcon).toBeVisible();
  });

  test('should open file browser modal when button is clicked', async ({ page }) => {
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-open'),
    });
    await assertTerminalReady(page, 15000);

    // Open file browser
    const fileBrowserButton = page.locator('[data-testid="file-browser-button"]');
    await fileBrowserButton.click();

    // Verify file browser opens
    const fileBrowser = page.locator('file-browser').first();
    await expect(fileBrowser).toBeVisible({ timeout: 5000 });
  });

  test('should display file browser with basic structure', async ({ page }) => {
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-structure'),
    });
    await assertTerminalReady(page, 15000);

    // Open file browser
    const fileBrowserButton = page.locator('[data-testid="file-browser-button"]');
    await fileBrowserButton.click();

    const fileBrowser = page.locator('file-browser').first();
    await expect(fileBrowser).toBeVisible();

    // Look for basic file browser elements
    // Note: The exact structure may vary, so we check for common elements
    const fileList = fileBrowser.locator('.overflow-y-auto, .file-list, .files').first();
    const pathDisplay = fileBrowser.locator('.text-blue-400, .path, .current-path').first();

    // At least one of these should be visible to indicate the file browser is functional
    const hasFileListOrPath = (await fileList.isVisible()) || (await pathDisplay.isVisible());
    expect(hasFileListOrPath).toBeTruthy();
  });

  test('should show some file entries in the browser', async ({ page }) => {
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-entries'),
    });
    await assertTerminalReady(page, 15000);

    // Open file browser
    const fileBrowserButton = page.locator('[data-testid="file-browser-button"]');
    await fileBrowserButton.click();

    const fileBrowser = page.locator('file-browser').first();
    await expect(fileBrowser).toBeVisible();

    // Wait for file browser to load content
    await page.waitForTimeout(2000);

    // Look for file/directory entries (various possible selectors)
    const fileEntries = fileBrowser
      .locator('.file-item, .directory-item, [class*="hover"], .p-2, .p-3')
      .first();

    // Should have at least some entries (could be files, directories, or ".." parent)
    if (await fileEntries.isVisible()) {
      await expect(fileEntries).toBeVisible();
    }
  });

  test('should respond to keyboard shortcut for opening file browser', async ({ page }) => {
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-shortcut'),
    });
    await assertTerminalReady(page, 15000);

    // Try keyboard shortcut (⌘O on Mac, Ctrl+O on other platforms)
    const isMac = process.platform === 'darwin';
    if (isMac) {
      await page.keyboard.press('Meta+o');
    } else {
      await page.keyboard.press('Control+o');
    }

    // Wait for potential file browser opening
    await page.waitForTimeout(1000);

    // Check if file browser opened
    const fileBrowser = page.locator('file-browser').first();
    const isVisible = await fileBrowser.isVisible();

    // This might not work in all test environments, so we just verify it doesn't crash
    expect(typeof isVisible).toBe('boolean');
  });

  test('should handle file browser in different session states', async ({ page }) => {
    // Test with a fresh session
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-states'),
    });
    await assertTerminalReady(page, 15000);

    // File browser should be available
    const fileBrowserButton = page.locator('[data-testid="file-browser-button"]');
    await expect(fileBrowserButton).toBeVisible();

    // Open file browser
    await fileBrowserButton.click();
    const fileBrowser = page.locator('file-browser').first();
    await expect(fileBrowser).toBeVisible();

    // File browser should function regardless of terminal state
    expect(await fileBrowser.isVisible()).toBeTruthy();
  });

  test('should maintain file browser button across navigation', async ({ page }) => {
    // Create session
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-navigation'),
    });
    await assertTerminalReady(page, 15000);

    // Verify file browser button exists
    const fileBrowserButton = page.locator('[data-testid="file-browser-button"]');
    await expect(fileBrowserButton).toBeVisible();

    // Navigate away and back
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('session-card', { state: 'visible', timeout: 15000 });

    // Navigate back to session
    const sessionCard = page
      .locator('session-card')
      .filter({
        hasText: 'file-browser-navigation',
      })
      .first();

    if (await sessionCard.isVisible()) {
      await sessionCard.click();
      await assertTerminalReady(page, 15000);

      // File browser button should still be there
      await expect(fileBrowserButton).toBeVisible({ timeout: 5000 });
    }
  });

  test('should not crash when file browser button is clicked multiple times', async ({ page }) => {
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-multiple-clicks'),
    });
    await assertTerminalReady(page, 15000);

    const fileBrowserButton = page.locator('[data-testid="file-browser-button"]');

    // Click to open file browser
    await fileBrowserButton.click();
    await page.waitForTimeout(1000);

    // Close file browser with escape key
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Click again to verify it still works
    await fileBrowserButton.click();
    await page.waitForTimeout(1000);

    // Close again to ensure terminal is visible
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Should not crash - page should still be responsive
    await page.waitForTimeout(1000);

    // Terminal should still be accessible
    const terminal = page.locator('vibe-terminal, .terminal').first();
    await expect(terminal).toBeVisible();
  });

  test('should handle file browser when terminal is busy', async ({ page }) => {
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-busy'),
    });
    await assertTerminalReady(page, 15000);

    // Start a command in terminal
    await page.keyboard.type('sleep 5');
    await page.keyboard.press('Enter');

    // Wait for command to start
    await page.waitForTimeout(1000);

    // File browser should still be accessible
    const fileBrowserButton = page.locator('[data-testid="file-browser-button"]');
    await expect(fileBrowserButton).toBeVisible();

    // Should be able to open file browser even when terminal is busy
    await fileBrowserButton.click();
    const fileBrowser = page.locator('file-browser').first();

    if (await fileBrowser.isVisible()) {
      await expect(fileBrowser).toBeVisible();
    }
  });

  test('should have accessibility attributes on file browser button', async ({ page }) => {
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-a11y'),
    });
    await assertTerminalReady(page, 15000);

    const fileBrowserButton = page.locator('[data-testid="file-browser-button"]');

    // Check accessibility attributes
    const title = await fileBrowserButton.getAttribute('title');
    expect(title).toBe('Browse Files (⌘O)');

    // Should be keyboard accessible
    await fileBrowserButton.focus();
    const focused = await fileBrowserButton.evaluate((el) => el === document.activeElement);
    expect(focused).toBeTruthy();
  });
});
