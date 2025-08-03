import { expect, test } from '@playwright/test';

/**
 * Ultra-minimal smoke test for CI
 *
 * This test verifies only the most basic functionality:
 * 1. App loads without crashing
 * 2. Basic UI elements are present
 * 3. Server responds to API calls
 *
 * All complex session creation, terminal interaction, and
 * file browser tests have been removed for CI speed.
 */

test.describe('Smoke Tests', () => {
  test.setTimeout(10000); // 10 second timeout

  test('should load the application', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');

    // Wait for the app to load (check for the actual app element)
    await expect(page.locator('vibe-tunnel-app, app-root, body')).toBeVisible({ timeout: 5000 });

    // Check that basic elements are present
    await expect(page.locator('session-list')).toBeVisible({ timeout: 3000 });

    // Verify no critical errors
    const errorElements = page.locator('.error, [data-testid="error"]');
    await expect(errorElements).toHaveCount(0);

    console.log('✅ App loaded successfully');
  });

  test('should respond to API health check', async ({ request }) => {
    // Test that the server is responding
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);

    console.log('✅ API health check passed');
  });
});
