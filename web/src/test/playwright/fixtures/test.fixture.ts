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
  // Performance-optimized page fixture
  page: async ({ page }, use) => {
    // Set up page with proper timeout handling
    page.setDefaultTimeout(testConfig.defaultTimeout);
    page.setDefaultNavigationTimeout(testConfig.navigationTimeout);

    // Aggressive resource blocking for performance
    await page.route('**/*', (route) => {
      const url = route.request().url();
      const resourceType = route.request().resourceType();

      // Allow only essential resources for localhost
      if (url.includes('localhost') || url.includes('127.0.0.1')) {
        // Block non-essential resource types even for localhost
        const blockedLocalTypes = ['image', 'font', 'media'];
        if (blockedLocalTypes.includes(resourceType)) {
          return route.abort();
        }

        // Allow only necessary file extensions
        const allowedExtensions = ['.js', '.css', '.html', '/api/', '.json'];
        const hasAllowedExtension = allowedExtensions.some((ext) => url.includes(ext));

        if (
          !hasAllowedExtension &&
          resourceType !== 'document' &&
          resourceType !== 'xhr' &&
          resourceType !== 'fetch'
        ) {
          return route.abort();
        }

        return route.continue();
      }

      // Block all external resources
      return route.abort();
    });

    // Only do initial setup on first navigation
    const isFirstNavigation = !page.url() || page.url() === 'about:blank';

    if (isFirstNavigation) {
      // Navigate to home
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      // Inject CSS to skip animations for faster tests
      await page.addStyleTag({
        content: `
          *, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition-duration: 0s !important;
            transition-delay: 0s !important;
            scroll-behavior: auto !important;
          }
        `,
      });

      // Clear storage for clean state
      await page
        .evaluate(() => {
          localStorage.clear();
          sessionStorage.clear();
          // Keep hideExitedSessions as false for testing
          localStorage.setItem('hideExitedSessions', 'false');

          if (typeof indexedDB !== 'undefined' && indexedDB.deleteDatabase) {
            indexedDB.deleteDatabase('vibetunnel-offline').catch(() => {});
          }
        })
        .catch(() => {});

      // Reload to pick up settings
      await page.reload({ waitUntil: 'domcontentloaded' });

      // Wait for app initialization with reduced timeout
      await page.waitForSelector('vibetunnel-app', { state: 'attached', timeout: 5000 });

      // Wait for at least one element to be visible
      try {
        await Promise.race([
          page.waitForSelector('button[title="Create New Session"]', {
            state: 'visible',
            timeout: 3000,
          }),
          page.waitForSelector('auth-login', { state: 'visible', timeout: 3000 }),
          page.waitForSelector('session-card', { state: 'visible', timeout: 3000 }),
        ]);
      } catch (_error) {
        // If all fail, give more specific error
        throw new Error('App initialization failed - no expected elements found');
      }
    }

    // Use the page
    await use(page);

    // Minimal cleanup after test
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
