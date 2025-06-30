import type { Locator, Page } from '@playwright/test';
import { screenshotOnError } from '../helpers/screenshot.helper';
import { WaitUtils } from '../utils/test-utils';

export class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async navigate(path = '/') {
    await this.page.goto(path, { waitUntil: 'domcontentloaded', timeout: 10000 });

    // Wait for app to attach
    await this.page.waitForSelector('vibetunnel-app', { state: 'attached', timeout: 5000 });

    // Clear localStorage for test isolation
    await this.page.evaluate(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (e) {
        console.warn('Could not clear storage:', e);
      }
    });
  }

  async waitForLoadComplete() {
    // Wait for the main app to be loaded
    await this.page.waitForSelector('vibetunnel-app', { state: 'attached', timeout: 5000 });

    // Wait for app to be fully initialized
    try {
      // Wait for either session list or create button to be visible
      await this.page.waitForSelector(
        '[data-testid="create-session-button"], button[title="Create New Session"]',
        {
          state: 'visible',
          timeout: 5000,
        }
      );
    } catch (_error) {
      // If create button is not immediately visible, wait for it to appear
      // The button might be hidden while sessions are loading
      const createBtn = this.page.locator('button[title="Create New Session"]');

      // Wait for the button to become visible - this automatically retries
      try {
        await createBtn.waitFor({ state: 'visible', timeout: 5000 });
      } catch (_waitError) {
        // Check if we're on auth screen
        const authForm = await this.page.locator('auth-login').isVisible();
        if (authForm) {
          throw new Error('Authentication required but server should be running with --no-auth');
        }

        // If still no create button after extended wait, something is wrong
        throw new Error('Create button did not appear within timeout');
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
