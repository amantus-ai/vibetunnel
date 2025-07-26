import type { Page } from '@playwright/test';

/**
 * Waits for an element to be stable (not moving or changing)
 */
export async function waitForElementStable(
  page: Page,
  selector: string,
  options: { timeout?: number; stableTime?: number } = {}
): Promise<void> {
  const { timeout = 3000, stableTime = 300 } = options;

  // First wait for element to exist
  await page.waitForSelector(selector, { state: 'visible', timeout });

  // Then wait for it to be stable
  await page.waitForFunction(
    ({ sel, stable }) => {
      const element = document.querySelector(sel);
      if (!element) return false;

      const checkStable = () => {
        const rect1 = element.getBoundingClientRect();
        const text1 = element.textContent;

        return new Promise((resolve) => {
          setTimeout(() => {
            const rect2 = element.getBoundingClientRect();
            const text2 = element.textContent;

            resolve(
              rect1.x === rect2.x &&
                rect1.y === rect2.y &&
                rect1.width === rect2.width &&
                rect1.height === rect2.height &&
                text1 === text2
            );
          }, stable);
        });
      };

      return checkStable();
    },
    { sel: selector, stable: stableTime },
    { timeout }
  );
}

/**
 * Waits for network to settle (no pending requests)
 */
export async function waitForNetworkSettled(
  page: Page,
  options: { timeout?: number; idleTime?: number } = {}
): Promise<void> {
  const { timeout = 5000, idleTime = 500 } = options;

  try {
    await page.waitForLoadState('domcontentloaded', { timeout });
  } catch {
    // Fallback: wait for no network activity for idleTime
    let lastRequestTime = Date.now();
    const requestHandler = () => {
      lastRequestTime = Date.now();
    };

    page.on('request', requestHandler);

    // Use waitForFunction instead of polling loop
    await page.waitForFunction(
      ({ lastReq, idle }) => Date.now() - lastReq > idle,
      { lastReq: lastRequestTime, idle: idleTime },
      { timeout, polling: 100 }
    );

    page.off('request', requestHandler);
  }
}

/**
 * Waits for animations to complete
 */
export async function waitForAnimationComplete(
  page: Page,
  selector: string,
  timeout = 5000
): Promise<void> {
  await page.waitForFunction(
    (sel) => {
      const element = document.querySelector(sel);
      if (!element) return false;

      const animations = element.getAnimations?.() || [];
      return animations.every((animation) => animation.playState === 'finished');
    },
    selector,
    { timeout }
  );
}

/**
 * Waits for text content to change from a previous value
 */
export async function waitForTextChange(
  page: Page,
  selector: string,
  previousText: string,
  timeout = 5000
): Promise<string> {
  const newText = await page.waitForFunction(
    ({ sel, oldText }) => {
      const element = document.querySelector(sel);
      if (!element) return null;

      const currentText = element.textContent || '';
      return currentText !== oldText ? currentText : null;
    },
    { sel: selector, oldText: previousText },
    { timeout }
  );

  return newText as string;
}

/**
 * Waits for element to be interactive (visible, enabled, not covered)
 */
export async function waitForElementInteractive(
  page: Page,
  selector: string,
  timeout = 5000
): Promise<void> {
  // Wait for element to be visible
  await page.waitForSelector(selector, { state: 'visible', timeout });

  // Wait for element to be enabled and not covered
  await page.waitForFunction(
    (sel) => {
      const element = document.querySelector(sel) as HTMLElement;
      if (!element) return false;

      // Check if disabled
      if ('disabled' in element && (element as HTMLInputElement).disabled) return false;

      // Check if covered by another element
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const topElement = document.elementFromPoint(centerX, centerY);

      return element.contains(topElement) || element === topElement;
    },
    selector,
    { timeout }
  );
}

/**
 * Waits for modal or overlay to disappear
 */
export async function waitForModalClosed(
  page: Page,
  modalSelector = '.modal-content',
  timeout = 5000
): Promise<void> {
  try {
    await page.waitForSelector(modalSelector, { state: 'hidden', timeout });
  } catch {
    // If selector doesn't exist, that's fine - modal is closed
  }

  // Also wait for any backdrop/overlay
  await page
    .waitForFunction(
      () => {
        const backdrop = document.querySelector('.modal-backdrop, .overlay, [class*="backdrop"]');
        return !backdrop || (backdrop as HTMLElement).style.display === 'none';
      },
      { timeout: 2000 }
    )
    .catch(() => {}); // Ignore if no backdrop
}

/**
 * Waits for a count of elements to reach expected value
 */
export async function waitForElementCount(
  page: Page,
  selector: string,
  expectedCount: number,
  timeout = 5000
): Promise<void> {
  await page.waitForFunction(
    ({ sel, count }) => {
      const elements = document.querySelectorAll(sel);
      return elements.length === count;
    },
    { sel: selector, count: expectedCount },
    { timeout }
  );
}

/**
 * Waits for async operation with loading indicator
 */
export async function waitForLoadingComplete(
  page: Page,
  loadingSelector = '[class*="loading"], [class*="spinner"], .loader',
  timeout = 10000
): Promise<void> {
  // First wait for loading indicator to appear (if it will)
  try {
    await page.waitForSelector(loadingSelector, { state: 'visible', timeout: 1000 });
  } catch {
    // Loading might not appear for fast operations
    return;
  }

  // Then wait for it to disappear
  await page.waitForSelector(loadingSelector, { state: 'hidden', timeout });
}

/**
 * Waits with exponential backoff for a condition
 */
export async function waitWithBackoff<T>(
  fn: () => Promise<T | null>,
  options: { maxAttempts?: number; initialDelay?: number; maxDelay?: number } = {}
): Promise<T> {
  const { maxAttempts = 10, initialDelay = 100, maxDelay = 5000 } = options;

  let delay = initialDelay;

  for (let i = 0; i < maxAttempts; i++) {
    const result = await fn();
    if (result !== null) return result;

    if (i < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, maxDelay);
    }
  }

  throw new Error('Condition not met after maximum attempts');
}
