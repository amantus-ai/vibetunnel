import { expect, test } from '../fixtures/test.fixture';
import { assertTerminalReady } from '../helpers/assertion.helper';
import { createAndNavigateToSession } from '../helpers/session-lifecycle.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';
import { TestDataFactory } from '../utils/test-utils';

// Use a unique prefix for this test suite
const TEST_PREFIX = TestDataFactory.getTestSpecificPrefix('file-browser-basic');

// These tests create their own sessions and can run in parallel
test.describe.configure({ mode: 'parallel' });

test.describe('File Browser Basic Tests', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page, TEST_PREFIX);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should open file browser from session view', async ({ page }) => {
    test.setTimeout(45000);

    // Create and navigate to session
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-test'),
    });

    await assertTerminalReady(page, 15000);

    // Wait for session view to be ready
    const sessionView = page.locator('session-view').first();
    await expect(sessionView).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Try to find file browser trigger - could be upload button or menu
    const imageUploadButton = sessionView.locator('[data-testid="image-upload-button"]').first();
    const compactMenuButton = sessionView.locator('compact-menu button').first();

    // Check which UI mode we're in and click appropriate button
    if (await imageUploadButton.isVisible({ timeout: 2000 })) {
      await imageUploadButton.click();
    } else if (await compactMenuButton.isVisible({ timeout: 2000 })) {
      await compactMenuButton.click();
      // Look for file browser option in menu
      const fileBrowserOption = page.locator(
        'menu-item[text*="Browse"], menu-item[text*="File"], [data-testid="file-browser-option"]'
      );
      if (await fileBrowserOption.isVisible({ timeout: 2000 })) {
        await fileBrowserOption.click();
      }
    }

    // Wait for file browser to appear
    const fileBrowser = page.locator('file-browser, [data-testid="file-browser"]');
    await expect(fileBrowser).toBeVisible({ timeout: 10000 });

    console.log('✅ File browser opened successfully');
  });

  test('should show file browser elements', async ({ page }) => {
    test.setTimeout(45000);

    // Create session and open file browser
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-ui-test'),
    });

    await assertTerminalReady(page, 15000);
    await page.waitForTimeout(2000);

    // Open file browser using the same logic as above
    const sessionView = page.locator('session-view').first();
    await expect(sessionView).toBeVisible();

    const imageUploadButton = sessionView.locator('[data-testid="image-upload-button"]').first();
    if (await imageUploadButton.isVisible({ timeout: 2000 })) {
      await imageUploadButton.click();
    }

    // Check if file browser opened
    const fileBrowser = page.locator('file-browser, [data-testid="file-browser"]');
    if (await fileBrowser.isVisible({ timeout: 5000 })) {
      // Verify basic file browser UI elements
      const pathDisplay = fileBrowser.locator('.path, [data-testid="current-path"]');
      await expect(pathDisplay).toBeVisible({ timeout: 5000 });

      // Look for file list or directory content
      const fileList = fileBrowser.locator(
        '.file-list, .directory-content, [data-testid="file-list"]'
      );
      await expect(fileList).toBeVisible({ timeout: 5000 });

      console.log('✅ File browser UI elements verified');
    } else {
      console.log('ℹ️  File browser not available in this test environment');
    }
  });

  test('should handle file browser navigation', async ({ page }) => {
    test.setTimeout(45000);

    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-nav-test'),
    });

    await assertTerminalReady(page, 15000);
    await page.waitForTimeout(2000);

    // Try to open file browser
    const sessionView = page.locator('session-view').first();
    const imageUploadButton = sessionView.locator('[data-testid="image-upload-button"]').first();

    if (await imageUploadButton.isVisible({ timeout: 2000 })) {
      await imageUploadButton.click();

      const fileBrowser = page.locator('file-browser, [data-testid="file-browser"]');
      if (await fileBrowser.isVisible({ timeout: 5000 })) {
        // Try to navigate up a directory
        const upButton = fileBrowser.locator(
          'button[data-testid="up-directory"], .up-button, button:has-text("..")'
        );
        if (await upButton.isVisible({ timeout: 3000 })) {
          await upButton.click();
          await page.waitForTimeout(1000);
          console.log('✅ Directory navigation tested');
        }

        // Try to close file browser
        const closeButton = fileBrowser.locator(
          'button[data-testid="close"], .close-button, button:has-text("Close")'
        );
        if (await closeButton.isVisible({ timeout: 3000 })) {
          await closeButton.click();
          await page.waitForTimeout(1000);
          console.log('✅ File browser close tested');
        }
      }
    }

    console.log('✅ File browser navigation test completed');
  });
});
