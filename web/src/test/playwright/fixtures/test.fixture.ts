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

    // Clean up all existing sessions for a fresh start
    try {
      // First, make sure exited sessions are visible
      const showExitedButton = page
        .locator('button')
        .filter({ hasText: /Show Exited/i })
        .first();
      if (await showExitedButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await showExitedButton.click();
        // Wait for exited sessions to become visible
        await page
          .waitForFunction(
            () => {
              const cards = document.querySelectorAll('session-card');
              return Array.from(cards).some((card) =>
                card.textContent?.toLowerCase().includes('exited')
              );
            },
            { timeout: 2000 }
          )
          .catch(() => {});
      }

      // Clean up exited sessions
      const cleanExitedButton = page
        .locator('button')
        .filter({ hasText: /Clean Exited/i })
        .first();
      if (await cleanExitedButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await cleanExitedButton.click();
        // Wait for exited sessions to be removed from DOM
        await page
          .waitForFunction(
            () => {
              const cards = document.querySelectorAll('session-card');
              const exitedCards = Array.from(cards).filter((card) =>
                card.textContent?.toLowerCase().includes('exited')
              );
              return exitedCards.length === 0;
            },
            { timeout: 2000 }
          )
          .catch(() => {});
      }

      // Kill all running sessions if Kill All button is available
      const killAllButton = page
        .locator('button')
        .filter({ hasText: /Kill All/i })
        .first();
      if (await killAllButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        // Handle confirmation dialog
        page.once('dialog', (dialog) => dialog.accept());
        await killAllButton.click();
        // Wait for kill operation to complete - all sessions should show exited or be gone
        await page
          .waitForFunction(
            () => {
              const cards = document.querySelectorAll('session-card');
              // Either no cards visible, or all visible cards are exited
              return (
                cards.length === 0 ||
                Array.from(cards).every((card) =>
                  card.textContent?.toLowerCase().includes('exited')
                )
              );
            },
            { timeout: 4000 }
          )
          .catch(() => {});

        // Clean up the newly exited sessions
        const cleanExitedButton2 = page
          .locator('button')
          .filter({ hasText: /Clean Exited/i })
          .first();
        if (await cleanExitedButton2.isVisible({ timeout: 1000 }).catch(() => false)) {
          await cleanExitedButton2.click();
          // Wait for all session cards to be removed
          await page
            .waitForFunction(
              () => {
                const cards = document.querySelectorAll('session-card');
                return cards.length === 0;
              },
              { timeout: 2000 }
            )
            .catch(() => {});
        }
      }
    } catch (error) {
      // If cleanup fails, it's not critical - continue with the test
      console.log('Session cleanup before test failed:', error);
    }

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
