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
  page: async ({ page, context }, use) => {
    // Set up page with proper timeout handling
    const defaultTimeout = testConfig.defaultTimeout;
    const navigationTimeout = testConfig.navigationTimeout;
    page.setDefaultTimeout(defaultTimeout);
    page.setDefaultNavigationTimeout(navigationTimeout);

    // Block unnecessary resources for faster loading
    await context.route('**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf,ico}', (route) => route.abort());
    await context.route('**/analytics/**', (route) => route.abort());
    await context.route('**/gtag/**', (route) => route.abort());

    // Suppress expected console errors to reduce noise
    page.on('console', (msg) => {
      const text = msg.text();
      // Suppress known harmless errors
      if (
        text.includes('Failed to load resource: net::ERR_FAILED') ||
        text.includes('Control event stream error') ||
        text.includes('stream connection error') ||
        text.includes('EventSource') ||
        text.includes('WebSocket')
      ) {
        return; // Suppress these expected errors
      }
      // Only log actual errors
      if (msg.type() === 'error' && !text.includes('[') && !text.includes(']')) {
        console.log(`Browser console error: ${text}`);
      }
    });

    // Track responses for debugging in CI
    if (process.env.CI) {
      page.on('response', (response) => {
        if (response.url().includes('/api/sessions') && response.request().method() === 'POST') {
          response
            .json()
            .then((data) => {
              console.log(`[CI Debug] Session created: ${JSON.stringify(data)}`);
            })
            .catch(() => {});
        }
      });
    }

    // Only do initial setup on first navigation, not on subsequent navigations during test
    const isFirstNavigation = !page.url() || page.url() === 'about:blank';

    if (isFirstNavigation) {
      // Navigate to home before test - use 'commit' for faster loading
      await page.goto('/', { waitUntil: 'commit' });

      // Clear storage BEFORE test to ensure clean state
      await page
        .evaluate(() => {
          // Clear all storage
          localStorage.clear();
          sessionStorage.clear();

          // Reset critical UI state to defaults
          // For tests, we want to see exited sessions since commands might exit quickly
          localStorage.setItem('hideExitedSessions', 'false'); // Show exited sessions in tests

          // IMPORTANT: Set spawn window to false by default for tests
          // This ensures sessions are created as web sessions, not native terminals
          localStorage.setItem('vibetunnel_spawn_window', 'false');

          // Clear any saved command to ensure tests use the default
          localStorage.removeItem('vibetunnel_last_command');
          localStorage.removeItem('vibetunnel_last_working_dir');

          // Clear IndexedDB if present
          if (typeof indexedDB !== 'undefined' && indexedDB.deleteDatabase) {
            indexedDB.deleteDatabase('vibetunnel-offline').catch(() => {});
          }
        })
        .catch(() => {});

      // Reload the page so the app picks up the localStorage settings
      await page.reload({ waitUntil: 'commit' });

      // Add styles to disable animations after page load
      // Wrap in try-catch to handle CSP issues gracefully
      try {
        await page.addStyleTag({
          content: `
            *, *::before, *::after {
              animation-duration: 0s !important;
              animation-delay: 0s !important;
              transition-duration: 0s !important;
              transition-delay: 0s !important;
            }
          `,
        });
      } catch {
        // CSP might block inline styles in some environments
        console.log(
          'Could not inject animation-disabling styles (CSP restriction), continuing without them'
        );
      }

      // Wait for the app to be attached (fast)
      await page.waitForSelector('vibetunnel-app', { state: 'attached', timeout: 5000 });

      // For no-auth mode, wait for session list; for auth mode, wait for login
      try {
        await page.waitForSelector('button[title="Create New Session"], auth-login', {
          state: 'visible',
          timeout: 3000,
        });
      } catch {
        // If neither shows up quickly, that's okay - individual tests will handle it
      }

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
