import { test as base } from '@playwright/test';
import { SessionListPage } from '../pages/session-list.page';
import { SessionViewPage } from '../pages/session-view.page';
import { testConfig } from '../test-config';

// Declare the types of fixtures
type TestFixtures = {
  sessionListPage: SessionListPage;
  sessionViewPage: SessionViewPage;
};

// Extend base test with our fixtures
export const test = base.extend<TestFixtures>({
  // Override page fixture to ensure clean state
  page: async ({ page }, use) => {
    // Set up page with proper timeout handling
    page.setDefaultTimeout(testConfig.defaultTimeout);
    page.setDefaultNavigationTimeout(testConfig.navigationTimeout);

    // Only do initial setup on first navigation, not on subsequent navigations during test
    const isFirstNavigation = !page.url() || page.url() === 'about:blank';

    if (isFirstNavigation) {
      // Navigate to home before test
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      // Clear storage BEFORE test to ensure clean state
      await page
        .evaluate(() => {
          // Clear all storage
          localStorage.clear();
          sessionStorage.clear();

          // Reset critical UI state to defaults
          localStorage.setItem('hideExitedSessions', String(testConfig.hideExitedSessions)); // Default: hide exited sessions

          // Clear IndexedDB if present
          if (typeof indexedDB !== 'undefined' && indexedDB.deleteDatabase) {
            indexedDB.deleteDatabase('vibetunnel-offline').catch(() => {});
          }
        })
        .catch(() => {});

      // Skip session cleanup during tests to avoid interfering with test scenarios
      // Tests should manage their own session state
      console.log('Skipping automatic session cleanup in test fixture');
    } // End of isFirstNavigation check

    // Use the page
    await use(page);

    // Cleanup after test
    await page
      .evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      })
      .catch(() => {});
  },

  sessionListPage: async ({ page }, use) => {
    const sessionListPage = new SessionListPage(page);
    await use(sessionListPage);
  },

  sessionViewPage: async ({ page }, use) => {
    const sessionViewPage = new SessionViewPage(page);
    await use(sessionViewPage);
  },
});

// Re-export expect from Playwright
export { expect } from '@playwright/test';
