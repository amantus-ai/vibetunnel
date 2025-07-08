import { expect, test } from '../fixtures/test.fixture';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

test.describe('File Browser in Session Create Form', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);
    await page.goto('/');
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('file browser should appear above session create modal', async ({ page }) => {
    // Open create session modal
    const createButton = page.locator('[data-testid="create-session-button"]');
    await createButton.click();

    // Wait for modal to be visible
    const sessionModal = page.locator('[data-testid="session-create-modal"]');
    await expect(sessionModal).toBeVisible({ timeout: 5000 });

    // Click browse button
    const browseButton = page.locator('button[title="Browse directories"]');
    await expect(browseButton).toBeVisible();
    await browseButton.click();

    // File browser should be visible
    const fileBrowser = page.locator('[data-testid="file-browser"]');
    await expect(fileBrowser).toBeVisible({ timeout: 5000 });

    // Verify file browser is above session create modal by checking z-index
    const fileBrowserZIndex = await fileBrowser.evaluate((el) => {
      const parent = el.parentElement;
      if (!parent) return '0';
      return window.getComputedStyle(parent).zIndex;
    });
    expect(Number.parseInt(fileBrowserZIndex)).toBeGreaterThan(1000); // Modal backdrop is z-index: 1000

    // Verify we can interact with file browser (not blocked by modal)
    const backButton = page.locator('button:has-text("Back")').first();
    await expect(backButton).toBeVisible();

    // Close file browser
    await page.keyboard.press('Escape');
    await expect(fileBrowser).not.toBeVisible({ timeout: 5000 });

    // Session create modal should still be visible
    await expect(sessionModal).toBeVisible();
  });

  test('should select directory from file browser', async ({ page }) => {
    // Open create session modal
    const createButton = page.locator('[data-testid="create-session-button"]');
    await createButton.click();

    // Wait for modal
    await expect(page.locator('[data-testid="session-create-modal"]')).toBeVisible();

    // Get initial working directory value
    const workingDirInput = page.locator('[data-testid="working-dir-input"]');
    const initialValue = await workingDirInput.inputValue();

    // Open file browser
    const browseButton = page.locator('button[title="Browse directories"]');
    await browseButton.click();

    // Wait for file browser
    const fileBrowser = page.locator('[data-testid="file-browser"]');
    await expect(fileBrowser).toBeVisible({ timeout: 5000 });

    // Look for parent directory option if available
    const parentDirButton = page.locator('[title=".."]');
    if (await parentDirButton.isVisible({ timeout: 2000 })) {
      await parentDirButton.click();
      await page.waitForTimeout(1000); // Wait for directory change

      // Click select directory button
      const selectButton = page.locator('button:has-text("Select Directory")');
      await expect(selectButton).toBeVisible();
      await selectButton.click();

      // File browser should close
      await expect(fileBrowser).not.toBeVisible({ timeout: 5000 });

      // Working directory should be updated
      const newValue = await workingDirInput.inputValue();
      expect(newValue).not.toBe(initialValue);
    } else {
      // If no parent directory, just cancel
      await page.keyboard.press('Escape');
      await expect(fileBrowser).not.toBeVisible();
    }
  });

  test('file browser cancel should return to session create modal', async ({ page }) => {
    // Open create session modal
    const createButton = page.locator('[data-testid="create-session-button"]');
    await createButton.click();

    // Open file browser
    const browseButton = page.locator('button[title="Browse directories"]');
    await browseButton.click();

    // Wait for file browser
    const fileBrowser = page.locator('[data-testid="file-browser"]');
    await expect(fileBrowser).toBeVisible({ timeout: 5000 });

    // Click cancel button
    const cancelButton = page.locator('button:has-text("Cancel")').last();
    await cancelButton.click();

    // File browser should close
    await expect(fileBrowser).not.toBeVisible({ timeout: 5000 });

    // Session create modal should still be visible
    const sessionModal = page.locator('[data-testid="session-create-modal"]');
    await expect(sessionModal).toBeVisible();
  });
});
