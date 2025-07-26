import type { Page } from '@playwright/test';

/**
 * Optimized wait utilities for faster test execution
 */

/**
 * Wait for app initialization - optimized for speed
 */
export async function waitForAppReady(page: Page): Promise<void> {
  // Wait for app element
  await page.waitForSelector('vibetunnel-app', {
    state: 'attached',
    timeout: process.env.CI ? 5000 : 3000,
  });

  // Quick check if we're in auth or no-auth mode
  const hasCreateButton = await page
    .locator('[data-testid="create-session-button"]')
    .isVisible({ timeout: 100 })
    .catch(() => false);
  const hasAuthForm = await page
    .locator('auth-login')
    .isVisible({ timeout: 100 })
    .catch(() => false);

  if (!hasCreateButton && !hasAuthForm) {
    // Wait a bit more for one of them to appear
    await page
      .waitForSelector('[data-testid="create-session-button"], auth-login', {
        state: 'visible',
        timeout: process.env.CI ? 5000 : 2000,
      })
      .catch(() => {
        // If neither appears, that's okay - let individual tests handle it
      });
  }
}

/**
 * Fast element visibility check with short timeout
 */
export async function isElementVisible(
  page: Page,
  selector: string,
  timeout = 500
): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * Optimized navigation with minimal wait
 */
export async function navigateToHome(page: Page): Promise<void> {
  if (!page.url().endsWith('/')) {
    await page.goto('/', { waitUntil: 'commit' });
    await waitForAppReady(page);
  }
}

/**
 * Fast session creation without unnecessary waits
 */
export async function quickCreateSession(
  page: Page,
  name: string,
  spawnWindow = false
): Promise<string | null> {
  // Click create button
  const createButton = page.locator('[data-testid="create-session-button"]');
  await createButton.click();

  // Wait for form to be ready
  await page.waitForSelector('session-create-form[visible="true"]', {
    timeout: process.env.CI ? 5000 : 2000,
  });

  // Fill name
  const nameInput = page.locator('input[placeholder*="Session name"]');
  await nameInput.fill(name);

  // Set spawn window if needed
  if (spawnWindow) {
    const spawnToggle = page.locator('[data-testid="spawn-window-toggle"]');
    if (await spawnToggle.isVisible({ timeout: 500 })) {
      await spawnToggle.click();
    }
  }

  // Submit form
  await page.keyboard.press('Enter');

  // For web sessions, wait for navigation
  if (!spawnWindow) {
    try {
      await page.waitForURL(/\/session\//, { timeout: process.env.CI ? 5000 : 3000 });
      const match = page.url().match(/\/session\/([^/?]+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Suppress console noise for cleaner test output
 */
export function suppressConsoleNoise(page: Page): void {
  page.on('console', (msg) => {
    const text = msg.text();
    // List of known harmless messages to suppress
    const suppressPatterns = [
      'Failed to load resource: net::ERR_FAILED',
      'Control event stream error',
      'stream connection error',
      'EventSource',
      'WebSocket',
      'Cast message stream closed',
      '[control-event-service]',
      '[cast-converter]',
    ];

    if (suppressPatterns.some((pattern) => text.includes(pattern))) {
      return; // Suppress these
    }

    // Only log real errors
    if (msg.type() === 'error') {
      console.log(`Console error: ${text}`);
    }
  });
}

/**
 * Wait for element with exponential backoff for reliability
 */
export async function waitForElementWithRetry(
  page: Page,
  selector: string,
  options: { timeout?: number; state?: 'attached' | 'visible' | 'hidden' | 'detached' } = {}
): Promise<void> {
  const { timeout = process.env.CI ? 10000 : 5000, state = 'visible' } = options;
  const delays = [100, 200, 400, 800, 1600];
  let lastError: Error | null = null;

  for (const delay of delays) {
    try {
      await page.waitForSelector(selector, { state, timeout: delay });
      return; // Success
    } catch (error) {
      lastError = error as Error;
      if (delay < timeout) {
        await page.waitForTimeout(Math.min(delay, timeout - delay));
      }
    }
  }

  // Final attempt with remaining timeout
  try {
    await page.waitForSelector(selector, {
      state,
      timeout: Math.max(timeout - delays.reduce((a, b) => a + b, 0), 1000),
    });
  } catch {
    throw lastError;
  }
}
