import type { Locator, Page } from '@playwright/test';

/**
 * Test data factory for generating consistent test data
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Utility class pattern for test helpers
export class TestDataFactory {
  /**
   * Generate a unique session name for testing
   */
  static sessionName(prefix = 'session'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate test command with output marker
   */
  static testCommand(command: string): string {
    const marker = `test-${Date.now()}`;
    return `${command} && echo "COMPLETE:${marker}"`;
  }
}

/**
 * Retry utility for flaky operations
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    retries?: number;
    delay?: number;
    timeout?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {}
): Promise<T> {
  const { retries = 3, delay = 1000, timeout = 4000, onRetry } = options;
  const startTime = Date.now();

  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      const elapsed = Date.now() - startTime;
      if (i === retries - 1 || elapsed > timeout) {
        throw error;
      }

      if (onRetry) {
        onRetry(i + 1, error as Error);
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error('Retry failed'); // Should never reach here
}

/**
 * Wait utilities for common scenarios
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Utility class pattern for test helpers
export class WaitUtils {
  /**
   * Wait for terminal to be ready (xterm initialized and visible)
   */
  static async waitForTerminalReady(page: Page, selector = '.xterm'): Promise<void> {
    // Wait for xterm container
    await page.waitForSelector(selector, { state: 'visible' });

    // Wait for xterm to be fully initialized
    await page.waitForFunction((sel) => {
      const term = document.querySelector(sel);
      if (!term) return false;

      // Check if xterm is initialized
      const screen = term.querySelector('.xterm-screen');
      const viewport = term.querySelector('.xterm-viewport');
      const textLayer = term.querySelector('.xterm-text-layer');

      return !!(screen && viewport && textLayer);
    }, selector);

    // Wait for terminal to be interactive
    await page.waitForFunction((sel) => {
      const viewport = document.querySelector(`${sel} .xterm-viewport`);
      return viewport && viewport.scrollHeight > 0;
    }, selector);
  }

  /**
   * Wait for shell prompt with improved detection
   */
  static async waitForShellPrompt(
    page: Page,
    options: {
      timeout?: number;
      customPrompts?: RegExp[];
      terminalSelector?: string;
    } = {}
  ): Promise<void> {
    const { timeout = 4000, customPrompts = [], terminalSelector = '.xterm-screen' } = options;

    const defaultPrompts = [
      /\$\s*/, // Bash prompt (removed $ anchor to handle trailing spaces)
      />\s*/, // Other shell prompts
      /\]\$\s*/, // Complex bash prompts
      /#\s*/, // Root prompt
      /%\s*/, // Zsh prompt
      /❯\s*/, // Custom prompts
    ];

    const prompts = [...defaultPrompts, ...customPrompts];

    await page.waitForFunction(
      ({ selector, patterns }) => {
        const term = document.querySelector(selector);
        if (!term) return false;

        const text = term.textContent || '';

        // Check if any prompt pattern exists in the terminal content
        return patterns.some((pattern) => {
          const regex = new RegExp(pattern);
          return regex.test(text);
        });
      },
      { selector: terminalSelector, patterns: prompts.map((p) => p.source) },
      { timeout }
    );
  }

  /**
   * Wait for command output to appear
   */
  static async waitForCommandOutput(
    page: Page,
    expectedOutput: string | RegExp,
    options: {
      timeout?: number;
      terminalSelector?: string;
    } = {}
  ): Promise<void> {
    const { timeout = 4000, terminalSelector = '.xterm-screen' } = options;

    await page.waitForFunction(
      ({ selector, expected, isRegex }) => {
        const term = document.querySelector(selector);
        if (!term) return false;

        const text = term.textContent || '';
        if (isRegex) {
          return new RegExp(expected).test(text);
        }
        return text.includes(expected);
      },
      {
        selector: terminalSelector,
        expected: expectedOutput instanceof RegExp ? expectedOutput.source : expectedOutput,
        isRegex: expectedOutput instanceof RegExp,
      },
      { timeout }
    );
  }

  /**
   * Wait for session to be created and ready
   */
  static async waitForSessionCreated(
    page: Page,
    sessionName: string,
    options: { timeout?: number } = {}
  ): Promise<void> {
    const { timeout = 4000 } = options;

    // Wait for session card to appear
    await page.waitForSelector(`session-card:has-text("${sessionName}")`, {
      state: 'visible',
      timeout,
    });

    // Wait for session to be active (not just created)
    await page.waitForFunction(
      (name) => {
        const card = Array.from(document.querySelectorAll('session-card')).find((el) =>
          el.textContent?.includes(name)
        );

        if (!card) return false;

        // Check if session is active (has status indicator)
        const status = card.querySelector('.status');
        return status && !status.textContent?.includes('Starting');
      },
      sessionName,
      { timeout }
    );
  }

  /**
   * Wait for element to be stable (not moving/changing)
   */
  static async waitForElementStable(
    locator: Locator,
    options: { timeout?: number; checkInterval?: number } = {}
  ): Promise<void> {
    const { timeout = 4000, checkInterval = 100 } = options;
    const startTime = Date.now();

    let previousBox: { x: number; y: number; width: number; height: number } | null = null;
    let stableCount = 0;
    const requiredStableChecks = 3;

    while (Date.now() - startTime < timeout) {
      try {
        const currentBox = await locator.boundingBox();

        if (!currentBox) {
          await new Promise((resolve) => setTimeout(resolve, checkInterval));
          continue;
        }

        if (
          previousBox &&
          previousBox.x === currentBox.x &&
          previousBox.y === currentBox.y &&
          previousBox.width === currentBox.width &&
          previousBox.height === currentBox.height
        ) {
          stableCount++;

          if (stableCount >= requiredStableChecks) {
            return;
          }
        } else {
          stableCount = 0;
        }

        previousBox = currentBox;
      } catch {
        // Element might not be ready yet
      }

      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    throw new Error(`Element did not stabilize within ${timeout}ms`);
  }

  /**
   * Wait for network to be idle
   */
  static async waitForNetworkIdle(
    page: Page,
    options: { timeout?: number; maxInflightRequests?: number } = {}
  ): Promise<void> {
    const { timeout = 4000, maxInflightRequests = 0 } = options;

    await page.waitForLoadState('networkidle', { timeout });

    // Additional check for any pending XHR/fetch requests
    await page.waitForFunction(
      (maxRequests) => {
        // @ts-ignore - accessing internal state
        const requests = window.performance
          .getEntriesByType('resource')
          .filter((entry) => entry.duration === 0);

        return requests.length <= maxRequests;
      },
      maxInflightRequests,
      { timeout: timeout / 2 }
    );
  }
}

/**
 * Assertion helpers for common checks
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Utility class pattern for test helpers
export class AssertionUtils {
  /**
   * Assert terminal contains expected text
   */
  static async assertTerminalContains(
    page: Page,
    expectedText: string,
    options: { terminalSelector?: string; timeout?: number } = {}
  ): Promise<void> {
    const { terminalSelector = '.xterm-screen', timeout = 4000 } = options;

    await WaitUtils.waitForCommandOutput(page, expectedText, {
      terminalSelector,
      timeout,
    });
  }

  /**
   * Assert terminal does not contain text
   */
  static async assertTerminalNotContains(
    page: Page,
    unexpectedText: string,
    options: { terminalSelector?: string; checkDuration?: number } = {}
  ): Promise<void> {
    const { terminalSelector = '.xterm-screen', checkDuration = 1000 } = options;

    // Check multiple times to ensure text doesn't appear
    const startTime = Date.now();
    while (Date.now() - startTime < checkDuration) {
      const hasText = await page.evaluate(
        ({ selector, text }) => {
          const term = document.querySelector(selector);
          return term?.textContent?.includes(text) || false;
        },
        { selector: terminalSelector, text: unexpectedText }
      );

      if (hasText) {
        throw new Error(`Terminal unexpectedly contains: "${unexpectedText}"`);
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/**
 * Terminal interaction utilities
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Utility class pattern for test helpers
export class TerminalUtils {
  /**
   * Type command with proper shell escaping
   */
  static async typeCommand(
    page: Page,
    command: string,
    options: { delay?: number; pressEnter?: boolean } = {}
  ): Promise<void> {
    const { delay = 50, pressEnter = true } = options;

    // Focus terminal first - try xterm textarea, fallback to terminal component
    try {
      await page.click('.xterm-helper-textarea', { force: true, timeout: 1000 });
    } catch {
      // Fallback for custom terminal component
      const terminal = await page.$('vibe-terminal');
      if (terminal) {
        await terminal.click();
      }
    }

    // Type command with delay for shell processing
    await page.keyboard.type(command, { delay });

    if (pressEnter) {
      await page.keyboard.press('Enter');
    }
  }

  /**
   * Execute command and wait for completion
   */
  static async executeCommand(
    page: Page,
    command: string,
    options: {
      waitForPrompt?: boolean;
      timeout?: number;
    } = {}
  ): Promise<void> {
    const { waitForPrompt = true, timeout = 4000 } = options;

    await TerminalUtils.typeCommand(page, command);

    if (waitForPrompt) {
      await WaitUtils.waitForShellPrompt(page, { timeout });
    }
  }

  /**
   * Get terminal output between markers
   */
  static async getOutputBetweenMarkers(
    page: Page,
    startMarker: string,
    endMarker: string,
    options: { terminalSelector?: string } = {}
  ): Promise<string> {
    const { terminalSelector = '.xterm-screen' } = options;

    return await page.evaluate(
      ({ selector, start, end }) => {
        const term = document.querySelector(selector);
        const text = term?.textContent || '';

        const startIndex = text.indexOf(start);
        const endIndex = text.indexOf(end, startIndex + start.length);

        if (startIndex === -1 || endIndex === -1) {
          return '';
        }

        return text.substring(startIndex + start.length, endIndex).trim();
      },
      { selector: terminalSelector, start: startMarker, end: endMarker }
    );
  }
}

/**
 * Screenshot utilities with proper paths
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Utility class pattern for test helpers
export class ScreenshotUtils {
  static getScreenshotPath(name: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `test-results/screenshots/${name}-${timestamp}.png`;
  }

  static async captureOnFailure(page: Page, testName: string): Promise<string | null> {
    try {
      const path = ScreenshotUtils.getScreenshotPath(`failure-${testName}`);
      await page.screenshot({ path, fullPage: true });
      return path;
    } catch (error) {
      console.error('Failed to capture screenshot:', error);
      return null;
    }
  }
}
