import type { Locator, Page } from '@playwright/test';
import { screenshotOnError } from '../helpers/screenshot.helper';
import { WaitUtils } from '../utils/test-utils';

/**
 * Base page object class that provides common functionality for all page objects.
 *
 * This class serves as the foundation for the Page Object Model pattern in Playwright tests,
 * providing shared utilities for navigation, element interaction, and state management.
 * It handles common tasks like navigating to pages, waiting for app initialization,
 * dismissing errors, and closing modals.
 *
 * @example
 * ```typescript
 * // Create a custom page object extending BasePage
 * class MyCustomPage extends BasePage {
 *   async doSomething() {
 *     await this.clickByTestId('my-button');
 *     await this.waitForText('Success!');
 *   }
 * }
 *
 * // Use in a test
 * const myPage = new MyCustomPage(page);
 * await myPage.navigate('/my-route');
 * await myPage.doSomething();
 * ```
 */
export class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async navigate(path = '/') {
    // Add test query parameter to help identify test environment
    const url = new URL(path, 'http://localhost');
    url.searchParams.set('test', 'true');
    const finalPath = url.pathname + url.search;

    await this.page.goto(finalPath, {
      waitUntil: 'domcontentloaded',
      timeout: process.env.CI ? 15000 : 10000,
    });

    // Wait for app to attach
    await this.page.waitForSelector('vibetunnel-app', {
      state: 'attached',
      timeout: process.env.CI ? 10000 : 5000,
    });
  }

  async waitForLoadComplete() {
    // Wait for the main app to be loaded
    await this.page.waitForSelector('vibetunnel-app', {
      state: 'attached',
      timeout: process.env.CI ? 10000 : 5000,
    });

    // Check if we're on auth screen
    const authForm = await this.page.locator('auth-login').count();
    if (authForm > 0) {
      // With --no-auth, we should automatically bypass auth
      console.log('Auth form detected, waiting for automatic bypass...');

      // Wait for auth to be bypassed and session list to appear
      await this.page.waitForSelector('session-list', {
        state: 'attached',
        timeout: process.env.CI ? 15000 : 10000,
      });
    }

    // Wait for app to be fully initialized
    try {
      // Wait for either session list or create button to be visible
      // The create button might have different titles in different contexts
      await this.page.waitForSelector(
        '[data-testid="create-session-button"], button[title="Create New Session"], button[title="Create New Session (⌘K)"]',
        {
          state: 'visible',
          timeout: process.env.CI ? 15000 : 10000,
        }
      );
    } catch (_error) {
      // If create button is not immediately visible, wait for it to appear
      // Try all possible selectors
      const createBtn = this.page
        .locator('[data-testid="create-session-button"]')
        .or(this.page.locator('button[title="Create New Session"]'))
        .or(this.page.locator('button[title="Create New Session (⌘K)"]'))
        .first();

      // Wait for the button to become visible - this automatically retries
      try {
        await createBtn.waitFor({ state: 'visible', timeout: process.env.CI ? 15000 : 10000 });
      } catch (_waitError) {
        // Log current page state for debugging
        const currentUrl = this.page.url();
        const hasSessionList = await this.page.locator('session-list').count();
        const hasSidebar = await this.page.locator('sidebar-header').count();
        const hasAuthForm = await this.page.locator('auth-login').count();

        console.error('Failed to find create button. Page state:', {
          url: currentUrl,
          hasSessionList,
          hasSidebar,
          hasAuthForm,
        });

        // Take screenshot for debugging
        await this.page.screenshot({ path: 'test-results/load-complete-failure.png' });

        // If still no create button after extended wait, something is wrong
        throw new Error(
          `Create button did not appear. State: sessionList=${hasSessionList}, sidebar=${hasSidebar}, auth=${hasAuthForm}`
        );
      }
    }

    // Dismiss any error messages
    await this.dismissErrors();
  }

  getByTestId(testId: string): Locator {
    return this.page.locator(`[data-testid="${testId}"]`);
  }

  async clickByTestId(testId: string) {
    await this.getByTestId(testId).click();
  }

  async fillByTestId(testId: string, value: string) {
    await this.getByTestId(testId).fill(value);
  }

  async waitForText(text: string, options?: { timeout?: number }) {
    await this.page.waitForSelector(`text="${text}"`, options);
  }

  async isVisible(selector: string): Promise<boolean> {
    return this.page.isVisible(selector);
  }

  async getText(selector: string): Promise<string> {
    return this.page.textContent(selector) || '';
  }

  async dismissErrors() {
    // Dismiss any error toasts
    const errorSelectors = ['.bg-status-error', '[role="alert"]', 'text="Failed to load sessions"'];
    for (const selector of errorSelectors) {
      try {
        const error = this.page.locator(selector).first();
        if (await error.isVisible({ timeout: 500 })) {
          await error.click({ force: true }).catch(() => {});
          await error.waitFor({ state: 'hidden', timeout: 1000 }).catch(() => {});
        }
      } catch (_e) {
        // Ignore
      }
    }
  }

  async closeAnyOpenModals() {
    try {
      // Check for any modal with class modal-content or modal-backdrop
      const modalSelectors = ['.modal-content', '.modal-backdrop'];

      for (const selector of modalSelectors) {
        const modal = this.page.locator(selector).first();
        if (await modal.isVisible({ timeout: 500 })) {
          console.log(`Found open modal with selector: ${selector}`);

          // Take a screenshot before closing
          await screenshotOnError(
            this.page,
            new Error('Modal still open, attempting to close'),
            'modal-before-close'
          );

          // Try multiple ways to close the modal
          // 1. Try Escape key first (more reliable)
          await this.page.keyboard.press('Escape');
          // Wait briefly for modal animation
          await WaitUtils.waitForElementStable(modal, { timeout: 1000 });

          // Check if modal is still visible
          if (await modal.isVisible({ timeout: 500 })) {
            console.log('Escape key did not close modal, trying close button');
            // 2. Try close button
            const closeButtons = [
              'button[aria-label="Close modal"]',
              'button:has-text("Cancel")',
              '.modal-content button:has(svg)',
              'button[title="Close"]',
            ];

            for (const buttonSelector of closeButtons) {
              const button = this.page.locator(buttonSelector).first();
              if (await button.isVisible({ timeout: 200 })) {
                console.log(`Clicking close button: ${buttonSelector}`);
                await button.click();
                break;
              }
            }
          }

          // Wait for modal to disappear
          await this.page.waitForSelector(selector, { state: 'hidden', timeout: 3000 });
          console.log(`Successfully closed modal with selector: ${selector}`);
        }
      }
    } catch (error) {
      console.error('Error while closing modals:', error);
      // Take a screenshot for debugging
      await screenshotOnError(
        this.page,
        error instanceof Error ? error : new Error(String(error)),
        'modal-close-error'
      );
    }
  }
}
