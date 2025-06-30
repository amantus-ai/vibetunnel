import { expect, type Page } from '@playwright/test';

/**
 * Asserts that a session is visible in the session list
 */
export async function assertSessionInList(
  page: Page,
  sessionName: string,
  options: { timeout?: number; status?: 'RUNNING' | 'EXITED' | 'KILLED' } = {}
): Promise<void> {
  const { timeout = 5000, status } = options;

  // Ensure we're on the session list page
  if (page.url().includes('?session=')) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // Extra wait for navigation to complete
    await page.waitForLoadState('networkidle');
  }

  // Wait for session list to be ready - check for cards or "no sessions" message
  await page.waitForFunction(
    () => {
      const cards = document.querySelectorAll('session-card');
      const noSessionsMsg = document.querySelector('.text-dark-text-muted');
      return cards.length > 0 || noSessionsMsg?.textContent?.includes('No terminal sessions');
    },
    { timeout }
  );

  // If we expect to find a session, wait for at least one card
  const hasCards = (await page.locator('session-card').count()) > 0;
  if (!hasCards) {
    throw new Error(`No session cards found on the page, cannot find session "${sessionName}"`);
  }

  // Find and verify the session card
  const sessionCard = page.locator(`session-card:has-text("${sessionName}")`);
  await expect(sessionCard).toBeVisible({ timeout });

  // Optionally verify status
  if (status) {
    // The DOM shows lowercase status values, so we need to check for both cases
    const lowerStatus = status.toLowerCase();

    // Look for the span with data-status attribute
    const statusElement = sessionCard.locator('span[data-status]').first();

    try {
      // Wait for the status element to be visible
      await expect(statusElement).toBeVisible({ timeout: 2000 });

      // Get the actual status from data attribute
      const dataStatus = await statusElement.getAttribute('data-status');
      const statusText = await statusElement.textContent();

      // Check if the status matches (case-insensitive)
      if (dataStatus?.toUpperCase() === status || statusText?.toUpperCase().includes(status)) {
        // Status matches
        return;
      }

      // If status is RUNNING but shows "waiting", that's also acceptable
      if (status === 'RUNNING' && statusText?.toLowerCase().includes('waiting')) {
        return;
      }

      throw new Error(
        `Expected status "${status}", but found data-status="${dataStatus}" and text="${statusText}"`
      );
    } catch {
      // If the span[data-status] approach fails, try other selectors
      const statusSelectors = [
        'span:has(.w-2.h-2.rounded-full)', // Status container with dot
        `span:has-text("${lowerStatus}")`, // Lowercase match
        `span:has-text("${status}")`, // Original case match
        `text=${lowerStatus}`, // Simple lowercase text
        `text=${status}`, // Simple original case text
      ];

      for (const selector of statusSelectors) {
        try {
          const element = sessionCard.locator(selector).first();
          const text = await element.textContent({ timeout: 500 });

          if (
            text &&
            (text.toUpperCase().includes(status) ||
              (status === 'RUNNING' && text.toLowerCase().includes('waiting')))
          ) {
            return;
          }
        } catch {
          // Try next selector
        }
      }

      // Final fallback: check if the status text exists anywhere in the card
      const cardText = await sessionCard.textContent();
      if (
        !cardText?.toUpperCase().includes(status) &&
        !(status === 'RUNNING' && cardText?.toLowerCase().includes('waiting'))
      ) {
        throw new Error(
          `Could not find status "${status}" in session card. Card text: "${cardText}"`
        );
      }
    }
  }
}

/**
 * Asserts that terminal contains specific text
 */
export async function assertTerminalContains(
  page: Page,
  text: string | RegExp,
  options: { timeout?: number; exact?: boolean } = {}
): Promise<void> {
  const { timeout = 5000, exact = false } = options;

  if (typeof text === 'string' && exact) {
    await page.waitForFunction(
      ({ searchText }) => {
        const terminal = document.querySelector('vibe-terminal');
        return terminal?.textContent === searchText;
      },
      { searchText: text },
      { timeout }
    );
  } else {
    const terminal = page.locator('vibe-terminal');
    await expect(terminal).toContainText(text, { timeout });
  }
}

/**
 * Asserts that terminal does NOT contain specific text
 */
export async function assertTerminalNotContains(
  page: Page,
  text: string | RegExp,
  options: { timeout?: number } = {}
): Promise<void> {
  const { timeout = 5000 } = options;

  const terminal = page.locator('vibe-terminal');
  await expect(terminal).not.toContainText(text, { timeout });
}

/**
 * Asserts that URL has session query parameter
 */
export async function assertUrlHasSession(page: Page, sessionId?: string): Promise<void> {
  const url = page.url();

  // Check if URL has session parameter
  const hasSessionParam = url.includes('?session=') || url.includes('&session=');
  if (!hasSessionParam) {
    throw new Error(`Expected URL to contain session parameter, but got: ${url}`);
  }

  if (sessionId) {
    // Parse URL to get session ID
    const urlObj = new URL(url);
    const actualSessionId = urlObj.searchParams.get('session');

    if (actualSessionId !== sessionId) {
      throw new Error(
        `Expected session ID "${sessionId}", but got "${actualSessionId}" in URL: ${url}`
      );
    }
  }
}

/**
 * Asserts element state
 */
export async function assertElementState(
  page: Page,
  selector: string,
  state: 'visible' | 'hidden' | 'enabled' | 'disabled' | 'checked' | 'unchecked',
  timeout = 5000
): Promise<void> {
  const element = page.locator(selector);

  switch (state) {
    case 'visible':
      await expect(element).toBeVisible({ timeout });
      break;
    case 'hidden':
      await expect(element).toBeHidden({ timeout });
      break;
    case 'enabled':
      await expect(element).toBeEnabled({ timeout });
      break;
    case 'disabled':
      await expect(element).toBeDisabled({ timeout });
      break;
    case 'checked':
      await expect(element).toBeChecked({ timeout });
      break;
    case 'unchecked':
      await expect(element).not.toBeChecked({ timeout });
      break;
  }
}

/**
 * Asserts session count in list
 */
export async function assertSessionCount(
  page: Page,
  expectedCount: number,
  options: { timeout?: number; operator?: 'exact' | 'minimum' | 'maximum' } = {}
): Promise<void> {
  const { timeout = 5000, operator = 'exact' } = options;

  // Ensure we're on the session list page
  if (page.url().includes('?session=')) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  }

  await page.waitForFunction(
    ({ expected, op }) => {
      const cards = document.querySelectorAll('session-card');
      const count = cards.length;

      switch (op) {
        case 'exact':
          return count === expected;
        case 'minimum':
          return count >= expected;
        case 'maximum':
          return count <= expected;
        default:
          return false;
      }
    },
    { expected: expectedCount, op: operator },
    { timeout }
  );

  // Get actual count for better error messages
  const cards = await page.locator('session-card').all();
  const actualCount = cards.length;

  switch (operator) {
    case 'exact':
      expect(actualCount).toBe(expectedCount);
      break;
    case 'minimum':
      expect(actualCount).toBeGreaterThanOrEqual(expectedCount);
      break;
    case 'maximum':
      expect(actualCount).toBeLessThanOrEqual(expectedCount);
      break;
  }
}

/**
 * Asserts terminal is ready and responsive
 */
export async function assertTerminalReady(page: Page, timeout = 5000): Promise<void> {
  // Check terminal element exists
  const terminal = page.locator('vibe-terminal');
  await expect(terminal).toBeVisible({ timeout });

  // Check for prompt
  await page.waitForFunction(
    () => {
      const term = document.querySelector('vibe-terminal');
      const content = term?.textContent || '';
      return /[$>#%❯]\s*$/.test(content);
    },
    { timeout }
  );
}

/**
 * Asserts modal is open with specific content
 */
export async function assertModalOpen(
  page: Page,
  options: { title?: string; content?: string; timeout?: number } = {}
): Promise<void> {
  const { title, content, timeout = 5000 } = options;

  const modal = page.locator('.modal-content');
  await expect(modal).toBeVisible({ timeout });

  if (title) {
    const modalTitle = modal.locator('h2, h3, [class*="title"]').first();
    await expect(modalTitle).toContainText(title);
  }

  if (content) {
    await expect(modal).toContainText(content);
  }
}

/**
 * Asserts no errors are displayed
 */
export async function assertNoErrors(page: Page): Promise<void> {
  // Check for common error selectors
  const errorSelectors = [
    '[class*="error"]:visible',
    '[class*="alert"]:visible',
    '[role="alert"]:visible',
    'text=/error|failed|exception/i',
  ];

  for (const selector of errorSelectors) {
    const errors = await page.locator(selector).all();
    expect(errors).toHaveLength(0);
  }
}

/**
 * Asserts element has specific CSS property
 */
export async function assertElementStyle(
  page: Page,
  selector: string,
  property: string,
  value: string | RegExp
): Promise<void> {
  const actualValue = await page
    .locator(selector)
    .evaluate((el, prop) => window.getComputedStyle(el).getPropertyValue(prop), property);

  if (typeof value === 'string') {
    expect(actualValue).toBe(value);
  } else {
    expect(actualValue).toMatch(value);
  }
}

/**
 * Asserts network request was made
 */
export async function assertRequestMade(
  page: Page,
  urlPattern: string | RegExp,
  options: { method?: string; timeout?: number } = {}
): Promise<void> {
  const { method, timeout = 5000 } = options;

  const requestPromise = page.waitForRequest(
    (request) => {
      const urlMatches =
        typeof urlPattern === 'string'
          ? request.url().includes(urlPattern)
          : urlPattern.test(request.url());

      const methodMatches = !method || request.method() === method;

      return urlMatches && methodMatches;
    },
    { timeout }
  );

  await requestPromise;
}
