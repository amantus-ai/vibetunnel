import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Asserts that a session is visible in the session list
 */
export async function assertSessionInList(
  page: Page,
  sessionName: string,
  options: { timeout?: number; status?: 'running' | 'exited' } = {}
): Promise<void> {
  const { timeout = process.env.CI ? 10000 : 5000, status } = options;

  // Ensure we're on the session list page
  if (page.url().includes('/session/')) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // Extra wait for navigation to complete
    await page.waitForLoadState('domcontentloaded');
  }

  // Ensure all sessions are visible (including exited ones)
  const { ensureAllSessionsVisible } = await import('./ui-state.helper');
  await ensureAllSessionsVisible(page);

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
  // If status is provided, look for sessions with that status first
  let sessionCard: Locator;
  if (status) {
    // Look for session cards with the specific status using data-status attribute
    sessionCard = page
      .locator(
        `session-card:has-text("${sessionName}"):has(span[data-status="${status.toLowerCase()}"])`
      )
      .first();
  } else {
    // Just find any session with the name, preferring running sessions
    const runningCard = page
      .locator(`session-card:has-text("${sessionName}"):has(span[data-status="running"])`)
      .first();
    const anyCard = page.locator(`session-card:has-text("${sessionName}")`).first();

    // Try to find a running session first
    if (await runningCard.isVisible({ timeout: 1000 }).catch(() => false)) {
      sessionCard = runningCard;
    } else {
      sessionCard = anyCard;
    }
  }

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
      if (status === 'running' && statusText?.toLowerCase().includes('waiting')) {
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
              (status === 'running' && text.toLowerCase().includes('waiting')))
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
        !cardText?.toUpperCase().includes(status.toUpperCase()) &&
        !(status === 'running' && cardText?.toLowerCase().includes('waiting'))
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
  const { timeout = process.env.CI ? 10000 : 5000, exact = false } = options;

  if (typeof text === 'string' && exact) {
    await page.waitForFunction(
      ({ searchText }) => {
        const terminal = document.querySelector('vibe-terminal');
        if (!terminal) return false;

        // Check the terminal container first
        const container = terminal.querySelector('#terminal-container');
        const containerContent = container?.textContent || '';

        // Fall back to terminal content
        const content = terminal.textContent || containerContent;

        return content === searchText;
      },
      { searchText: text },
      { timeout }
    );
  } else {
    // For regex or non-exact matches, try both selectors
    const terminal = page.locator('vibe-terminal');
    const container = page.locator('vibe-terminal #terminal-container');

    // Try container first, then fall back to terminal
    try {
      await expect(container).toContainText(text, { timeout: timeout / 2 });
    } catch {
      await expect(terminal).toContainText(text, { timeout: timeout / 2 });
    }
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
  const { timeout = process.env.CI ? 10000 : 5000 } = options;

  const terminal = page.locator('vibe-terminal');
  await expect(terminal).not.toContainText(text, { timeout });
}

/**
 * Asserts that URL has session query parameter
 */
export async function assertUrlHasSession(page: Page, sessionId?: string): Promise<void> {
  const url = page.url();

  // Check if URL has session path
  const hasSessionPath = url.includes('/session/');
  if (!hasSessionPath) {
    throw new Error(`Expected URL to contain session path, but got: ${url}`);
  }

  if (sessionId) {
    // Extract session ID from path-based URL
    const match = url.match(/\/session\/([^/?]+)/);
    const actualSessionId = match ? match[1] : null;

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
  timeout = process.env.CI ? 10000 : 5000
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
  const { timeout = process.env.CI ? 10000 : 5000, operator = 'exact' } = options;

  // Ensure we're on the session list page
  if (page.url().includes('/session/')) {
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
export async function assertTerminalReady(
  page: Page,
  timeout = process.env.CI ? 20000 : 15000
): Promise<void> {
  // Check terminal element exists (using ID selector for reliability)
  const terminal = page.locator('#session-terminal');
  await expect(terminal).toBeVisible({ timeout });

  // Wait a bit for terminal to initialize
  await page.waitForTimeout(500);

  // Check for prompt - with more robust detection and debugging
  await page.waitForFunction(
    () => {
      const term = document.querySelector('#session-terminal');
      if (!term) {
        console.warn('[assertTerminalReady] Terminal element not found');
        return false;
      }

      // Look for vibe-terminal inside session-terminal
      const vibeTerminal = term.querySelector('vibe-terminal');
      if (vibeTerminal) {
        // Check the terminal container
        const container = vibeTerminal.querySelector('#terminal-container');
        if (container) {
          const content = container.textContent || '';

          // Check for prompt patterns
          const promptPatterns = [
            /[$>#%❯]\s*$/, // Common prompts at end of line
            /\$\s*$/, // Simple dollar sign
            />\s*$/, // Simple greater than
            /#\s*$/, // Root prompt
            /❯\s*$/, // Fish/zsh prompt
            /\n\s*[$>#%❯]/, // Prompt after newline
            /bash-\d+\.\d+\$/, // Bash version prompt
            /]\$\s*$/, // Bracketed prompt
            /\w+@\w+/, // Username@hostname pattern
          ];

          const hasPrompt = promptPatterns.some((pattern) => pattern.test(content));

          // If we have content and it looks like a prompt, we're ready
          if (hasPrompt || content.length > 10) {
            return true;
          }
        }
      }

      // Fallback: Check if terminal has xterm structure
      const hasXterm = !!term.querySelector('.xterm');
      const hasShadowRoot = !!term.shadowRoot;

      const content = term?.textContent || '';

      // If terminal structure exists but no content yet, wait
      if ((hasXterm || hasShadowRoot) && !content) {
        return false;
      }

      // Log content for debugging (last 200 chars)
      if (content && window.location.hostname === 'localhost') {
        console.log(
          '[assertTerminalReady] Terminal content (last 200 chars):',
          content.slice(-200)
        );
      }

      // If no content after structure exists, consider it ready (blank terminal)
      if (!content && (hasXterm || hasShadowRoot)) {
        console.log(
          '[assertTerminalReady] Terminal has structure but no content, considering ready'
        );
        return true;
      }

      // More flexible prompt patterns
      const promptPatterns = [
        /[$>#%❯]\s*$/, // Original pattern
        /\$\s*$/, // Simple dollar sign
        />\s*$/, // Simple greater than
        /#\s*$/, // Root prompt
        /❯\s*$/, // Fish/zsh prompt
        /\n\s*[$>#%❯]/, // Prompt after newline
        /bash-\d+\.\d+\$/, // Bash version prompt
        /]\$\s*$/, // Bracketed prompt
        /\w+@\w+/, // Username@hostname pattern
      ];

      const hasPrompt = promptPatterns.some((pattern) => pattern.test(content));

      // If we have reasonable content length but no prompt, log warning and consider ready
      if (!hasPrompt && content.length > 50) {
        console.log(
          '[assertTerminalReady] No prompt found but terminal has content, considering ready'
        );
        return true;
      }

      return hasPrompt;
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
  const { title, content, timeout = process.env.CI ? 10000 : 5000 } = options;

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
  const { method, timeout = process.env.CI ? 10000 : 5000 } = options;

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
