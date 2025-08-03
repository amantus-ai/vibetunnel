import type { Page } from '@playwright/test';

/**
 * Performance utilities for faster test execution
 */

/**
 * Disable animations and transitions for faster tests
 */
export async function disableAnimations(page: Page): Promise<void> {
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
}

/**
 * Batch multiple operations for efficiency
 */
export async function batchOperations<T>(
  operations: (() => Promise<T>)[],
  concurrency = 3
): Promise<T[]> {
  const results: T[] = [];

  for (let i = 0; i < operations.length; i += concurrency) {
    const batch = operations.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((op) => op()));
    results.push(...batchResults);
  }

  return results;
}

/**
 * Wait for network idle with timeout
 */
export async function waitForNetworkIdleWithTimeout(
  page: Page,
  options: { timeout?: number; maxInflightRequests?: number } = {}
): Promise<void> {
  const { timeout = 2000, maxInflightRequests = 0 } = options;

  try {
    await page.waitForLoadState('networkidle', { timeout });
  } catch {
    // If network doesn't become idle, continue anyway
    const pendingRequests = await page.evaluate(() => {
      return (window as Window & { __pendingRequests?: number }).__pendingRequests || 0;
    });

    if (pendingRequests > maxInflightRequests) {
      console.warn(`Network not idle: ${pendingRequests} requests still pending`);
    }
  }
}

/**
 * Optimized page navigation
 */
export async function fastGoto(
  page: Page,
  url: string,
  options: { waitFor?: 'commit' | 'domcontentloaded' | 'load' } = {}
): Promise<void> {
  const { waitFor = 'domcontentloaded' } = options;

  await Promise.all([
    page.goto(url, { waitUntil: waitFor, timeout: 5000 }),
    // Don't wait for all resources
    page
      .evaluate(() => {
        // Stop loading images and other resources
        window.stop();
      })
      .catch(() => {}), // Ignore errors
  ]);
}

/**
 * Check if element exists without waiting
 */
export async function elementExists(page: Page, selector: string): Promise<boolean> {
  return (await page.locator(selector).count()) > 0;
}

/**
 * Fast click with minimal checks
 */
export async function fastClick(
  page: Page,
  selector: string,
  options: { force?: boolean } = {}
): Promise<void> {
  const { force = false } = options;

  // Click without waiting for actionability checks if force is true
  if (force) {
    await page.locator(selector).click({ force: true, timeout: 1000 });
  } else {
    await page.locator(selector).click({ timeout: 2000 });
  }
}

/**
 * Type text without delays
 */
export async function fastType(page: Page, selector: string, text: string): Promise<void> {
  const element = page.locator(selector);

  // Clear and type in one operation
  await element.fill(text);
}

/**
 * Wait for any of multiple conditions
 */
export async function waitForAny(
  conditions: (() => Promise<unknown>)[],
  options: { timeout?: number } = {}
): Promise<number> {
  const { timeout = 5000 } = options;

  return new Promise((resolve, reject) => {
    let resolved = false;
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('Timeout waiting for any condition'));
      }
    }, timeout);

    conditions.forEach((condition, index) => {
      condition()
        .then(() => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            resolve(index);
          }
        })
        .catch(() => {}); // Ignore individual failures
    });
  });
}

/**
 * Mock slow API responses for faster tests
 */
export async function mockSlowAPIs(page: Page): Promise<void> {
  await page.route('**/*', async (route) => {
    const url = route.request().url();

    // Mock slow endpoints
    if (url.includes('/api/slow') || url.includes('/analytics')) {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({ mocked: true }),
      });
    } else {
      await route.continue();
    }
  });
}

/**
 * Prefetch resources for faster page loads
 */
export async function prefetchResources(page: Page): Promise<void> {
  // Prefetch common resources
  await page.evaluate(() => {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = '/bundle/client-bundle.js';
    document.head.appendChild(link);

    const styleLink = document.createElement('link');
    styleLink.rel = 'prefetch';
    styleLink.href = '/bundle/styles.css';
    document.head.appendChild(styleLink);
  });
}
