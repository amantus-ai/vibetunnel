import { expect, test } from '../fixtures/test.fixture';
import { waitForPageReady } from '../helpers/common-patterns.helper';
import { TestSessionManager } from '../helpers/test-data-manager.helper';

// These tests check screenshare functionality
test.describe.configure({ mode: 'parallel' });

test.describe('Screenshare Feature', () => {
  let sessionManager: TestSessionManager;

  test.beforeEach(async ({ page }) => {
    sessionManager = new TestSessionManager(page);
  });

  test.afterEach(async () => {
    await sessionManager.cleanupAllSessions();
  });

  test('should show screenshare button in session header', async ({ page }) => {
    // Skip on non-macOS platforms
    if (process.platform !== 'darwin') {
      test.skip();
      return;
    }

    // Create a session
    await page.goto('/');
    await waitForPageReady(page);

    await sessionManager.createTrackedSession();

    // Wait for session view to load
    await page.waitForSelector('session-view', { state: 'visible' });

    // Check for screenshare button in header
    const screenshareButton = page.locator('button[aria-label="Start screen sharing"]');
    await expect(screenshareButton).toBeVisible();
    await expect(screenshareButton).toHaveAttribute('title', 'Share Screen');
  });

  test('should navigate to screencap page when screenshare button clicked', async ({ page }) => {
    // Skip on non-macOS platforms
    if (process.platform !== 'darwin') {
      test.skip();
      return;
    }

    // Create a session
    await page.goto('/');
    await waitForPageReady(page);

    await sessionManager.createTrackedSession();

    // Wait for session view
    await page.waitForSelector('session-view', { state: 'visible' });

    // Click screenshare button
    const screenshareButton = page.locator('button[aria-label="Start screen sharing"]');
    await screenshareButton.click();

    // Should navigate to screencap page
    await page.waitForURL('**/api/screencap/', { timeout: 5000 });

    // Verify we're on the screencap page
    expect(page.url()).toContain('/api/screencap/');
  });

  test('should show error on non-macOS platforms', async ({ page }) => {
    // Only run on non-macOS platforms
    if (process.platform === 'darwin') {
      test.skip();
      return;
    }

    // Navigate directly to screencap endpoint
    const response = await page.goto('/api/screencap/');

    // Should get 503 error
    expect(response?.status()).toBe(503);

    // Check error message in response
    const body = await response?.json();
    expect(body).toEqual({
      error: 'Screencap is only available on macOS',
      platform: process.platform,
    });
  });

  test('should handle screencap page elements on macOS', async ({ page }) => {
    // Skip on non-macOS platforms
    if (process.platform !== 'darwin') {
      test.skip();
      return;
    }

    // Navigate directly to screencap page
    await page.goto('/api/screencap/');

    // Wait for screencap-view element
    await page.waitForSelector('screencap-view', { state: 'visible', timeout: 10000 });

    // Check for key UI elements
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible();

    // Check for desktop button
    const desktopButton = page.locator('.desktop-button');
    await expect(desktopButton).toBeVisible();
    await expect(desktopButton).toContainText('Desktop');

    // Check for capture display area
    const captureDisplay = page.locator('.capture-display');
    await expect(captureDisplay).toBeVisible();

    // Status should show as either loading or ready
    const status = page.locator('.status');
    await expect(status).toBeVisible();
    const statusText = await status.textContent();
    expect(['Loading screen capture...', 'Ready', 'Error']).toContain(
      statusText?.split(' - ')[0].trim()
    );
  });

  test('should maintain session context when navigating to screencap', async ({ page }) => {
    // Skip on non-macOS platforms
    if (process.platform !== 'darwin') {
      test.skip();
      return;
    }

    // Create a session
    await page.goto('/');
    await waitForPageReady(page);

    const { sessionId, sessionName } = await sessionManager.createTrackedSession();

    // Wait for session view
    await page.waitForSelector('session-view', { state: 'visible' });

    // Store current URL with session
    const sessionUrl = page.url();
    expect(sessionUrl).toContain(`session=${sessionId}`);

    // Navigate to screencap
    const screenshareButton = page.locator('button[aria-label="Start screen sharing"]');
    await screenshareButton.click();

    // Wait for navigation
    await page.waitForURL('**/api/screencap/', { timeout: 5000 });

    // Go back
    await page.goBack();

    // Should be back at session view
    await page.waitForURL(`**/?session=${sessionId}`, { timeout: 5000 });
    await page.waitForSelector('session-view', { state: 'visible' });

    // Verify session is still active
    const sessionHeader = page.locator('.session-header h2');
    await expect(sessionHeader).toContainText(sessionName);
  });

  test('should handle API errors gracefully', async ({ page }) => {
    // Skip on non-macOS platforms
    if (process.platform !== 'darwin') {
      test.skip();
      return;
    }

    // Mock API failure
    await page.route('**/api/screencap/windows', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });

    await page.route('**/api/screencap/display', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });

    // Navigate to screencap
    await page.goto('/api/screencap/');
    await page.waitForSelector('screencap-view', { state: 'visible' });

    // Should show error state
    const status = page.locator('.status.error');
    await expect(status).toBeVisible({ timeout: 5000 });
    await expect(status).toContainText('Error');

    // Error message should be displayed
    const errorMessage = page.locator('.error-message');
    await expect(errorMessage).toBeVisible();
    await expect(errorMessage).toContainText('Failed to load screen capture data');
  });
});
