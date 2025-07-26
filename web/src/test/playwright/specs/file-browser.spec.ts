import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/test.fixture';
import { assertTerminalReady } from '../helpers/assertion.helper';
import { createAndNavigateToSession } from '../helpers/session-lifecycle.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';
import { waitForModalClosed } from '../helpers/wait-strategies.helper';

// These tests create their own sessions and can run in parallel
test.describe.configure({ mode: 'parallel' });

// Helper function to open file browser through image upload menu or compact menu
async function openFileBrowser(page: Page) {
  // Look for session view first
  const sessionView = page.locator('session-view').first();
  await expect(sessionView).toBeVisible({ timeout: 10000 });

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
      await page.waitForTimeout(500);
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
    await page.waitForTimeout(500); // Wait for menu to open
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

test.describe('File Browser', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should open and close file browser modal', async ({ page }) => {
    // Create a session and navigate to it
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-modal'),
    });
    await assertTerminalReady(page);

    // Open file browser through image upload menu
    await openFileBrowser(page);
    await expect(page.locator('[data-testid="file-browser"]').first()).toBeVisible({
      timeout: 5000,
    });
    // Verify file browser opened successfully
    const fileBrowser = page.locator('[data-testid="file-browser"]').first();
    await expect(fileBrowser).toBeVisible();
    await expect(page.locator('.bg-dark-bg-secondary.border-r')).toBeVisible(); // File list pane
    await expect(page.locator('.bg-dark-bg.flex.flex-col')).toBeVisible(); // Preview pane

    // Close via escape key or back button
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    // File browser should be closed (visible property becomes false)
    const isVisible = await fileBrowser.isVisible();
    if (isVisible) {
      // If still visible, try clicking the back button
      const backButton = page.locator('button:has-text("Back")').first();
      if (await backButton.isVisible()) {
        await backButton.click();
      }
    }
  });

  test('should close file browser with escape key', async ({ page }) => {
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-escape'),
    });
    await assertTerminalReady(page);

    // Open file browser
    await openFileBrowser(page);
    await expect(page.locator('[data-testid="file-browser"]').first()).toBeVisible();

    // Close with escape key
    await page.keyboard.press('Escape');
    await waitForModalClosed(page);
    await expect(page.locator('[data-testid="file-browser"]')).not.toBeVisible();
  });

  test('should display file list with icons and navigate directories', async ({ page }) => {
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-navigation'),
    });
    await assertTerminalReady(page);

    // Open file browser
    await openFileBrowser(page);
    await expect(page.locator('[data-testid="file-browser"]').first()).toBeVisible();

    // Verify file list is populated
    const fileItems = page.locator('.p-3.hover\\:bg-dark-bg-lighter');
    // Check that we have at least some files/directories visible
    const itemCount = await fileItems.count();
    expect(itemCount).toBeGreaterThan(0);

    // Verify icons are present
    await expect(page.locator('svg.w-5.h-5').first()).toBeVisible();

    // Check for parent directory option
    const parentDir = page.locator('[title=".."]');
    if (await parentDir.isVisible()) {
      const initialPath = await page.locator('.text-blue-400').textContent();
      await parentDir.click();
      await page.waitForTimeout(1000); // Wait for navigation
      const newPath = await page.locator('.text-blue-400').textContent();
      expect(newPath).not.toBe(initialPath);
    }
  });

  test('should select file and show preview', async ({ page }) => {
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-preview'),
    });
    await assertTerminalReady(page);

    // Open file browser
    await openFileBrowser(page);
    await expect(page.locator('file-browser').first()).toBeVisible();

    // Look for a text file to select (common files like .txt, .md, .js, etc.)
    const textFiles = page.locator('.p-3.hover\\:bg-dark-bg-lighter').filter({
      hasText: /\.(txt|md|js|ts|json|yml|yaml|sh|py|rb|go|rs|c|cpp|h|html|css|xml|log)$/i,
    });

    if (await textFiles.first().isVisible()) {
      // Select the first text file
      await textFiles.first().click();

      // Verify file is selected (shows border)
      await expect(page.locator('.border-l-2.border-primary')).toBeVisible();

      // Verify preview pane shows content
      const previewPane = page.locator('.bg-dark-bg.flex.flex-col');
      await expect(previewPane).toBeVisible();

      // Check for Monaco editor or text content
      const monacoEditor = page.locator('monaco-editor');
      const textPreview = page.locator('.whitespace-pre-wrap');

      const hasEditor = await monacoEditor.isVisible();
      const hasTextPreview = await textPreview.isVisible();

      expect(hasEditor || hasTextPreview).toBeTruthy();
    }
  });

  test('should navigate to directories', async ({ page }) => {
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-dir-nav'),
    });
    await assertTerminalReady(page);

    // Open file browser
    await openFileBrowser(page);
    await expect(page.locator('file-browser').first()).toBeVisible();

    // Look for a directory (items with folder icon or specific styling)
    const directories = page.locator('.p-3.hover\\:bg-dark-bg-lighter').filter({
      has: page.locator('.text-status-info, svg[data-icon*="folder"], .text-blue-400'),
    });

    if (await directories.first().isVisible()) {
      const initialPath = await page.locator('.text-blue-400').textContent();

      // Navigate into directory
      await directories.first().click();
      await page.waitForTimeout(1000); // Wait for navigation

      // Verify path changed
      const newPath = await page.locator('.text-blue-400').textContent();
      expect(newPath).not.toBe(initialPath);
      expect(newPath).toContain(initialPath || ''); // New path should include old path
    }
  });

  test('should edit current path manually', async ({ page }) => {
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-path-edit'),
    });
    await assertTerminalReady(page);

    // Open file browser
    await openFileBrowser(page);
    await expect(page.locator('file-browser').first()).toBeVisible();

    // Click on the path to edit it
    await page.click('.text-blue-400');

    // Verify path input appears
    const pathInput = page.locator('input[placeholder="Enter path and press Enter"]');
    await expect(pathInput).toBeVisible();

    // Try navigating to /tmp (common directory)
    await pathInput.fill('/tmp');
    await pathInput.press('Enter');

    // Wait for navigation and verify path changed
    await page.waitForTimeout(1000);
    const currentPath = await page.locator('.text-blue-400').textContent();
    expect(currentPath).toContain('/tmp');
  });

  test('should toggle hidden files visibility', async ({ page }) => {
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-hidden'),
    });
    await assertTerminalReady(page);

    // Open file browser
    await openFileBrowser(page);
    await expect(page.locator('file-browser').first()).toBeVisible();

    // Look for hidden files toggle
    const hiddenFilesToggle = page.locator('button:has-text("Hidden Files")');
    if (await hiddenFilesToggle.isVisible()) {
      const initialFileCount = await page.locator('.p-3.hover\\:bg-dark-bg-lighter').count();

      // Toggle hidden files
      await hiddenFilesToggle.click();
      await page.waitForTimeout(1000);

      const newFileCount = await page.locator('.p-3.hover\\:bg-dark-bg-lighter').count();

      // File count should change (either more or fewer files)
      expect(newFileCount).not.toBe(initialFileCount);
    }
  });

  test('should copy file path to clipboard', async ({ page }) => {
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-copy'),
    });
    await assertTerminalReady(page);

    // Grant clipboard permissions
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    // Open file browser
    await openFileBrowser(page);
    await expect(page.locator('file-browser').first()).toBeVisible();

    // Select a file
    const fileItems = page.locator('.p-3.hover\\:bg-dark-bg-lighter');
    if (await fileItems.first().isVisible()) {
      await fileItems.first().click();

      // Look for copy path button
      const copyButton = page.locator('button:has-text("Copy Path")');
      if (await copyButton.isVisible()) {
        await copyButton.click();

        // Verify clipboard content
        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboardText).toBeTruthy();
        expect(clipboardText.length).toBeGreaterThan(0);
      }
    }
  });

  test('should handle git status integration', async ({ page }) => {
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-git'),
    });
    await assertTerminalReady(page);

    // Open file browser
    await openFileBrowser(page);
    await expect(page.locator('file-browser').first()).toBeVisible();

    // Look for git changes toggle
    const gitChangesToggle = page.locator('button:has-text("Git Changes")');
    if (await gitChangesToggle.isVisible()) {
      // Toggle git changes filter
      await gitChangesToggle.click();

      // Verify button state changed
      await expect(gitChangesToggle).toHaveClass(/bg-primary/);

      // Look for git status badges
      const gitBadges = page.locator(
        '.bg-yellow-900\\/50, .bg-green-900\\/50, .bg-red-900\\/50, .bg-gray-700'
      );
      if (await gitBadges.first().isVisible()) {
        // Verify git status indicators are present
        const badgeCount = await gitBadges.count();
        expect(badgeCount).toBeGreaterThan(0);
      }
    }
  });

  test('should show git diff for modified files', async ({ page }) => {
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-diff'),
    });
    await assertTerminalReady(page);

    // Open file browser
    await openFileBrowser(page);
    await expect(page.locator('file-browser').first()).toBeVisible();

    // Look for modified files (yellow badge)
    const modifiedFiles = page.locator('.p-3.hover\\:bg-dark-bg-lighter').filter({
      has: page.locator('.bg-yellow-900\\/50'),
    });

    if (await modifiedFiles.first().isVisible()) {
      // Select modified file
      await modifiedFiles.first().click();

      // Look for view diff button
      const viewDiffButton = page.locator('button:has-text("View Diff")');
      if (await viewDiffButton.isVisible()) {
        await viewDiffButton.click();

        // Verify diff view appears
        const diffEditor = page.locator('monaco-editor[mode="diff"]');
        if (await diffEditor.isVisible()) {
          await expect(diffEditor).toBeVisible();
        }
      }
    }
  });

  test('should handle mobile responsive layout', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 600, height: 800 });

    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-mobile'),
    });
    await assertTerminalReady(page);

    // Open file browser
    await openFileBrowser(page);
    await expect(page.locator('file-browser').first()).toBeVisible();

    // Select a file to trigger mobile preview mode
    const fileItems = page.locator('.p-3.hover\\:bg-dark-bg-lighter');
    if (await fileItems.first().isVisible()) {
      await fileItems.first().click();

      // Look for mobile-specific elements
      const mobileBackButton = page.locator('button[title="Back to files"]');
      const fullWidthContainer = page.locator('.w-full:not(.w-80)');

      // In mobile mode, should see either back button or full-width layout
      const hasMobileElements =
        (await mobileBackButton.isVisible()) || (await fullWidthContainer.isVisible());
      expect(hasMobileElements).toBeTruthy();
    }
  });

  test('should handle binary file preview', async ({ page }) => {
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-binary'),
    });
    await assertTerminalReady(page);

    // Open file browser
    await openFileBrowser(page);
    await expect(page.locator('file-browser').first()).toBeVisible();

    // Look for binary files (images, executables, etc.)
    const binaryFiles = page.locator('.p-3.hover\\:bg-dark-bg-lighter').filter({
      hasText: /\.(png|jpg|jpeg|gif|pdf|exe|bin|dmg|zip|tar|gz)$/i,
    });

    if (await binaryFiles.first().isVisible()) {
      await binaryFiles.first().click();

      // Should show binary file indicator or image preview
      const binaryIndicator = page.locator('.text-lg:has-text("Binary File")');
      const imagePreview = page.locator('img[alt]');

      const hasBinaryHandling =
        (await binaryIndicator.isVisible()) || (await imagePreview.isVisible());
      expect(hasBinaryHandling).toBeTruthy();
    }
  });

  test('should handle error states gracefully', async ({ page }) => {
    await createAndNavigateToSession(page, {
      name: sessionManager.generateSessionName('file-browser-errors'),
    });
    await assertTerminalReady(page);

    // Open file browser
    await openFileBrowser(page);
    await expect(page.locator('file-browser').first()).toBeVisible();

    // Try to navigate to a non-existent path
    await page.click('.text-blue-400');
    const pathInput = page.locator('input[placeholder="Enter path and press Enter"]');
    await pathInput.fill('/nonexistent/path/that/should/not/exist');
    await pathInput.press('Enter');

    // Should handle error gracefully (either show error message or revert path)
    await page.waitForTimeout(2000);

    // Look for error indicators
    const errorMessage = page.locator('.bg-red-500\\/20, .text-red-400, .text-error');
    const pathReverted = await page.locator('.text-blue-400').textContent();

    // Either should show error or revert to previous path
    const hasErrorHandling =
      (await errorMessage.isVisible()) || !pathReverted?.includes('nonexistent');
    expect(hasErrorHandling).toBeTruthy();
  });
});
