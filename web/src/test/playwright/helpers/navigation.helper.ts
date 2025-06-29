import type { Page } from '@playwright/test';

/**
 * Navigate back to the home page using UI elements instead of page.goto
 * This better simulates real user behavior and maintains session state
 */
export async function navigateToHome(page: Page): Promise<void> {
  // If we're already on the home page, do nothing
  const currentUrl = page.url();
  if (currentUrl.endsWith('/') && !currentUrl.includes('?session=')) {
    return;
  }

  // Try to click the Back button
  try {
    const backButton = page.locator('button').filter({ hasText: 'Back' }).first();
    if (await backButton.isVisible({ timeout: 1000 })) {
      await backButton.click();
      await page.waitForURL('/', { timeout: 5000 });

      // Wait for the session list to load after navigation
      // This ensures the app has time to fetch and render sessions
      await page.waitForLoadState('domcontentloaded');

      // Wait for session list or create button to be visible
      await page.waitForSelector(
        'session-card, button[title="Create New Session"], text="No active sessions"',
        { state: 'visible', timeout: 5000 }
      );
      return;
    }
  } catch (error) {
    // Back button click failed, try fallback methods
    console.log('Back button click failed:', error);
  }

  // Fallback: try browser back button
  try {
    await page.goBack();
    await page.waitForURL('/');
    await page.waitForLoadState('domcontentloaded');

    // Wait for session list or create button to be visible
    await page.waitForSelector(
      'session-card, button[title="Create New Session"], text="No active sessions"',
      { state: 'visible', timeout: 5000 }
    );
  } catch {
    // Last resort: use page.goto if all else fails
    // This should only happen at the very beginning of tests
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  }
}
