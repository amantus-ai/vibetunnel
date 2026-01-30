import type { Page } from '@playwright/test';

/**
 * Optimized wait utilities for faster test execution
 */

/**
 * Wait for app initialization - optimized for speed
 */
export async function waitForAppReady(page: Page): Promise<void> {
  // Wait for app element - reduced timeout
  await page.waitForSelector('vibetunnel-app', {
    state: 'attached',
    timeout: process.env.CI ? 3000 : 2000,
  });

  // Use Promise.race for faster element detection
  try {
    await Promise.race([
      page.waitForSelector('[data-testid="create-session-button"]', {
        state: 'visible',
        timeout: process.env.CI ? 3000 : 1500,
      }),
      page.waitForSelector('auth-login', {
        state: 'visible',
        timeout: process.env.CI ? 3000 : 1500,
      }),
    ]);
  } catch {
    // If neither appears quickly, that's okay - let individual tests handle it
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

  // Wait for form to be ready - reduced timeout
  await page.waitForSelector('session-create-form[visible="true"]', {
    timeout: process.env.CI ? 3000 : 1500,
  });

  // Fill name and submit in one go for speed
  const nameInput = page.locator('input[placeholder*="Session name"]');
  await nameInput.fill(name);

  // Set spawn window if needed
  if (spawnWindow) {
    const spawnToggle = page.locator('[data-testid="spawn-window-toggle"]');
    // Don't wait if not visible
    const isVisible = await spawnToggle.isVisible({ timeout: 100 });
    if (isVisible) {
      await spawnToggle.click();
    }
  }

  // Submit form
  await page.keyboard.press('Enter');

  // For web sessions, wait for navigation with reduced timeout
  if (!spawnWindow) {
    try {
      await page.waitForURL(/\/session\//, { timeout: process.env.CI ? 3000 : 2000 });
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
      'WebSocket',
      'Cast message stream closed',
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

/**
 * Wait for a session card to appear with improved reliability
 */
export async function waitForSessionCard(
  page: Page,
  sessionName: string,
  options: { timeout?: number; retries?: number } = {}
): Promise<void> {
  const { timeout = process.env.CI ? 20000 : 10000, retries = 3 } = options;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // First ensure the session list container is loaded
      await page.waitForSelector('vibetunnel-app', { state: 'attached', timeout: 5000 });

      // Wait for the session to appear in the DOM
      await page.waitForFunction(
        ({ name, attemptNum }) => {
          // Log for debugging in CI
          if (attemptNum === 0) {
            const cards = document.querySelectorAll('session-card');
            console.log(`Found ${cards.length} session cards in DOM`);
          }

          const cards = document.querySelectorAll('session-card');
          for (const card of cards) {
            const text = card.textContent || '';
            if (text.includes(name)) {
              return true;
            }
          }
          return false;
        },
        { name: sessionName, attemptNum: attempt },
        { timeout, polling: 500 }
      );

      // Success - session found
      return;
    } catch (error) {
      console.log(`Attempt ${attempt + 1}/${retries} failed to find session "${sessionName}"`);

      if (attempt < retries - 1) {
        // Not the last attempt - try recovery strategies

        // Check if we need to reload the page
        const hasSessionCards = await page
          .evaluate(() => {
            return document.querySelectorAll('session-card').length > 0;
          })
          .catch(() => {
            // Page might be closed due to timeout
            console.error('Page closed while checking for session cards');
            return false;
          });

        if (!hasSessionCards) {
          console.log('No session cards found, reloading page...');
          await page.reload({ waitUntil: 'domcontentloaded' });
          await waitForAppReady(page);
          await page.waitForTimeout(1000); // Give time for sessions to load
        } else {
          // Sessions exist but not the one we want - just wait a bit
          await page.waitForTimeout(2000);
        }
      } else {
        // Last attempt failed - log current state for debugging
        const currentState = await page
          .evaluate(() => {
            const cards = document.querySelectorAll('session-card');
            const sessionNames = Array.from(cards).map(
              (card) => card.textContent?.trim() || 'unknown'
            );
            return {
              sessionCount: cards.length,
              sessionNames,
              url: window.location.href,
            };
          })
          .catch((evalError) => {
            console.error('Failed to evaluate page state:', evalError.message);
            return { sessionCount: 'unknown', sessionNames: [], url: 'unknown' };
          });
        console.error('Failed to find session. Current state:', currentState);
        throw error;
      }
    }
  }
}
