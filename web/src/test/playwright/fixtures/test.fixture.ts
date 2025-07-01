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
      // Navigate to home with retry logic
      let retries = 3;
      let lastError: Error | null = null;

      while (retries > 0) {
        try {
          console.log(`[Test Setup] Attempting to navigate to home page (${4 - retries}/3)...`);
          await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
          console.log('[Test Setup] Navigation successful');
          break;
        } catch (error) {
          lastError = error as Error;
          console.error(`[Test Setup] Navigation failed:`, error);

          // Check if server is actually running
          try {
            const response = await page.request.get(`${testConfig.baseURL}/health`, {
              timeout: 5000,
            });
            console.log(`[Test Setup] Health check response: ${response.status()}`);
          } catch (healthError) {
            console.error('[Test Setup] Health check failed:', healthError);
          }

          retries--;
          if (retries > 0) {
            console.log(`[Test Setup] Waiting 2s before retry...`);
            await page.waitForTimeout(2000);
          }
        }
      }

      if (retries === 0 && lastError) {
        throw new Error(`Failed to navigate to home page after 3 attempts: ${lastError.message}`);
      }

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

      // Wait for app initialization with better error handling
      console.log('[Test Setup] Waiting for app initialization...');
      try {
        await page.waitForSelector('vibetunnel-app', { state: 'attached', timeout: 10000 });
        console.log('[Test Setup] App element found');

        // Wait a bit for the app to fully initialize
        await page.waitForTimeout(1000);
      } catch (error) {
        console.error('[Test Setup] App element not found:', error);
        const pageContent = await page.content();
        console.log('[Test Setup] Page content:', pageContent.substring(0, 500));
        throw new Error('vibetunnel-app element not found - server may not be running properly');
      }

      // Wait for at least one element to be visible
      try {
        console.log('[Test Setup] Waiting for UI elements...');

        // Check what view the app is in
        const appState = await page.evaluate(() => {
          const app = document.querySelector('vibetunnel-app') as any;
          return {
            currentView: app?.currentView,
            isAuthenticated: app?.isAuthenticated,
            loading: app?.loading,
            errorMessage: app?.errorMessage,
          };
        });
        console.log('[Test Setup] App state:', appState);

        await Promise.race([
          page
            .waitForSelector('button[title="Create New Session"]', {
              state: 'visible',
              timeout: 10000,
            })
            .then(() => console.log('[Test Setup] Found create session button')),
          page
            .waitForSelector('auth-login', { state: 'visible', timeout: 10000 })
            .then(() => console.log('[Test Setup] Found auth login element')),
          page
            .waitForSelector('session-card', { state: 'visible', timeout: 10000 })
            .then(() => console.log('[Test Setup] Found session card')),
        ]);
      } catch (_error) {
        console.error('[Test Setup] No expected elements found');
        // Log current page state
        const title = await page.title();
        const url = page.url();
        console.log(`[Test Setup] Page title: ${title}, URL: ${url}`);

        // Try to get any visible text
        const visibleText = await page.evaluate(() => document.body?.innerText || 'No body text');
        console.log('[Test Setup] Visible text:', visibleText.substring(0, 200));

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
