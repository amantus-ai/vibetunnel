import type { Locator, Page } from '@playwright/test';
import { TEST_TIMEOUTS } from '../config/test-constants';
import { logger } from './logger';

/**
 * Optimized wait utilities with reduced timeouts and smarter strategies
 */
export namespace OptimizedWaitUtils {
  // Reduced default timeouts for faster test execution
  const QUICK_TIMEOUT = TEST_TIMEOUTS.QUICK;
  const DEFAULT_TIMEOUT = TEST_TIMEOUTS.DEFAULT;

  /**
   * Wait for app initialization with optimized checks
   */
  export async function waitForAppReady(page: Page): Promise<void> {
    // Wait for app element to attach (reduced timeout)
    await page.waitForSelector('vibetunnel-app', {
      state: 'attached',
      timeout: DEFAULT_TIMEOUT,
    });

    // Use Promise.allSettled for better reliability
    const results = await Promise.allSettled([
      page.waitForSelector('button[title="Create New Session"]', {
        state: 'visible',
        timeout: QUICK_TIMEOUT,
      }),
      page.waitForSelector('session-card', {
        state: 'visible',
        timeout: QUICK_TIMEOUT,
      }),
      page.waitForSelector('auth-login', {
        state: 'visible',
        timeout: QUICK_TIMEOUT,
      }),
    ]);

    // Check if all promises were rejected
    if (results.every((r) => r.status === 'rejected')) {
      throw new Error('App initialization failed - no expected elements found');
    }

    // Log which element was found
    const successIndex = results.findIndex((r) => r.status === 'fulfilled');
    const states = ['session-list', 'has-sessions', 'login-required'];
    logger.info(`App ready with state: ${states[successIndex] || 'unknown'}`);
  }

  /**
   * Wait for session card with specific name
   */
  export async function waitForSessionCard(
    page: Page,
    sessionName: string,
    timeout = 3000
  ): Promise<Locator> {
    const locator = page.locator(`session-card:has-text("${sessionName}")`);
    await locator.waitFor({ state: 'visible', timeout });
    return locator;
  }

  /**
   * Wait for terminal to be ready (optimized)
   */
  export async function waitForTerminalReady(page: Page, timeout = 3000): Promise<void> {
    // Wait for xterm element
    await page.waitForSelector('.xterm', { state: 'visible', timeout });

    // Quick check for terminal initialization
    await page.waitForFunction(
      () => {
        const term = document.querySelector('.xterm');
        if (!term) return false;
        const screen = term.querySelector('.xterm-screen');
        return screen && screen.clientHeight > 0;
      },
      { timeout: timeout / 2 }
    );
  }

  /**
   * Wait for session state change
   */
  export async function waitForSessionState(
    page: Page,
    sessionName: string,
    expectedState: 'RUNNING' | 'EXITED',
    timeout = 5000
  ): Promise<boolean> {
    try {
      await page.waitForFunction(
        ({ name, state }) => {
          const cards = Array.from(document.querySelectorAll('session-card'));
          const targetCard = cards.find((card) => card.textContent?.includes(name));
          if (!targetCard) return false;

          const cardText = targetCard.textContent?.toLowerCase() || '';
          if (state === 'EXITED') {
            return cardText.includes('exit') || cardText.includes('stopped');
          } else {
            return cardText.includes('running') || cardText.includes('active');
          }
        },
        { name: sessionName, state: expectedState },
        { timeout }
      );
      return true;
    } catch (error) {
      logger.debug('Session state check failed:', error);
      return false;
    }
  }

  /**
   * Smart wait for navigation with fallback
   */
  export async function waitForNavigation(page: Page, url: string, timeout = 3000): Promise<void> {
    // Try to wait for URL change
    try {
      await page.waitForURL(url, { timeout });
    } catch (error) {
      // Fallback: check if we're already there
      if (!page.url().includes(url)) {
        throw new Error(`Navigation to ${url} failed`);
      }
      logger.debug('Navigation already at destination or timeout', error);
    }
  }

  /**
   * Wait for element count with early exit
   */
  export async function waitForElementCount(
    page: Page,
    selector: string,
    expectedCount: number,
    options?: { operator?: 'exact' | 'minimum' | 'maximum'; timeout?: number }
  ): Promise<void> {
    const { operator = 'exact', timeout = DEFAULT_TIMEOUT } = options || {};
    const pollInterval = 100;
    const maxAttempts = timeout / pollInterval;

    for (let i = 0; i < maxAttempts; i++) {
      const count = await page.locator(selector).count();

      const satisfied =
        operator === 'exact'
          ? count === expectedCount
          : operator === 'minimum'
            ? count >= expectedCount
            : count <= expectedCount;

      if (satisfied) return;

      await page.waitForTimeout(pollInterval);
    }

    throw new Error(`Element count condition not met for ${selector}`);
  }

  /**
   * Wait for any text content (useful for terminal output)
   */
  export async function waitForAnyText(locator: Locator, timeout = 2000): Promise<string> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const text = await locator.textContent();
      if (text && text.trim().length > 0) {
        return text;
      }
      await locator.page().waitForTimeout(50);
    }

    throw new Error('No text content found within timeout');
  }

  /**
   * Fast visibility check with retry
   */
  export async function isEventuallyVisible(locator: Locator, timeout = 1000): Promise<boolean> {
    try {
      await locator.waitFor({ state: 'visible', timeout });
      return true;
    } catch (error) {
      logger.debug('Element visibility check failed:', error);
      return false;
    }
  }

  /**
   * Wait for network idle with early exit
   */
  export async function waitForNetworkQuiet(
    page: Page,
    options?: { timeout?: number }
  ): Promise<void> {
    const { timeout = TEST_TIMEOUTS.NETWORK_QUIET } = options || {};

    // Track pending requests
    let pendingRequests = 0;
    const onRequest = () => pendingRequests++;
    const onResponse = () => pendingRequests--;

    page.on('request', onRequest);
    page.on('response', onResponse);
    page.on('requestfailed', onResponse);

    try {
      // Wait for existing requests to complete
      const startTime = Date.now();
      while (pendingRequests > 0 && Date.now() - startTime < timeout) {
        await page.waitForTimeout(50);
      }

      // Brief wait to ensure no new requests
      await page.waitForTimeout(100);
    } finally {
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfailed', onResponse);
    }
  }
}
