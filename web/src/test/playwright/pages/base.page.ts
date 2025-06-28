import type { Locator, Page } from '@playwright/test';
import { WaitUtils } from '../utils/test-utils';

export class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async navigate(path = '/') {
    await this.page.goto(path);
  }

  async waitForLoadComplete() {
    // Wait for the main app to be loaded
    await this.page.waitForSelector('vibetunnel-app', { state: 'attached' });
    // Wait for network to settle
    await WaitUtils.waitForNetworkIdle(this.page, { timeout: 5000 });
  }

  async getByTestId(testId: string): Promise<Locator> {
    return this.page.locator(`[data-testid="${testId}"]`);
  }

  async clickByTestId(testId: string) {
    await this.getByTestId(testId).then((el) => el.click());
  }

  async fillByTestId(testId: string, value: string) {
    await this.getByTestId(testId).then((el) => el.fill(value));
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
}
