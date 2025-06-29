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

  // Try to click the VibeTunnel logo/title to go home
  const appTitle = page.locator('button:has(h1:has-text("VibeTunnel"))').first();
  if (await appTitle.isVisible({ timeout: 1000 })) {
    await appTitle.click();
    await page.waitForURL('/');
    return;
  }

  // Fallback: try browser back button
  try {
    await page.goBack();
    await page.waitForURL('/');
  } catch {
    // Last resort: use page.goto if all else fails
    // This should only happen at the very beginning of tests
    await page.goto('/');
  }
}
