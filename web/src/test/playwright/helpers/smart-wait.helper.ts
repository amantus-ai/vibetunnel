import type { Page } from '@playwright/test';

/**
 * Smart wait utilities that replace static timeouts with dynamic conditions
 */
export class SmartWait {
  /**
   * Wait for a session to be fully created and ready
   */
  static async forSessionCreation(page: Page, sessionName: string): Promise<void> {
    // Wait for the session card to appear
    await page.waitForSelector(`session-card:has-text("${sessionName}")`, {
      state: 'visible',
      timeout: 5000,
    });

    // Wait for the session to show running status
    await page.waitForFunction(
      (name) => {
        // Find session card by iterating through all cards
        const cards = document.querySelectorAll('session-card');
        const card = Array.from(cards).find((el) => el.textContent?.includes(name));
        if (!card) return false;
        const text = card.textContent?.toLowerCase() || '';
        return text.includes('running') || text.includes('active');
      },
      sessionName,
      { timeout: 3000 }
    );
  }

  /**
   * Wait for terminal to be ready for input
   */
  static async forTerminalReady(page: Page): Promise<void> {
    // Wait for terminal element
    await page.waitForSelector('.xterm', { state: 'visible' });

    // Wait for terminal to be interactive
    await page.waitForFunction(
      () => {
        const terminal = document.querySelector('.xterm');
        if (!terminal) return false;

        // Check if terminal has rendered content
        const screen = terminal.querySelector('.xterm-screen');
        if (!screen || screen.clientHeight === 0) return false;

        // Check for cursor element
        const cursor = terminal.querySelector('.xterm-cursor-layer');
        return cursor !== null;
      },
      undefined,
      { timeout: 3000 }
    );
  }

  /**
   * Wait for command output with smart detection
   */
  static async forCommandOutput(
    page: Page,
    expectedText: string,
    options?: {
      timeout?: number;
      partial?: boolean;
    }
  ): Promise<void> {
    const { timeout = 5000, partial = true } = options || {};

    await page.waitForFunction(
      ({ expected, isPartial }) => {
        const terminal = document.querySelector('.xterm-screen');
        if (!terminal) return false;

        const content = terminal.textContent || '';
        return isPartial ? content.includes(expected) : content.endsWith(expected);
      },
      { expected: expectedText, isPartial: partial },
      { timeout }
    );
  }

  /**
   * Wait for prompt to appear (command ready)
   */
  static async forPrompt(page: Page, promptPattern = '$'): Promise<void> {
    await page.waitForFunction(
      (pattern) => {
        const terminal = document.querySelector('.xterm-screen');
        if (!terminal) return false;

        const lines = terminal.textContent?.split('\n') || [];
        const lastLine = lines[lines.length - 1].trim();

        // Common prompt patterns
        const patterns = [`${pattern} `, '> ', '# ', '% ', '❯ ', '➜ '];

        return patterns.some((p) => lastLine.endsWith(p));
      },
      promptPattern,
      { timeout: 3000 }
    );
  }

  /**
   * Wait for session to be killed
   */
  static async forSessionKilled(page: Page, sessionName: string): Promise<void> {
    // Wait for either the session to show exited status or disappear
    await page.waitForFunction(
      (name) => {
        const cards = document.querySelectorAll('session-card');
        const sessionCard = Array.from(cards).find((card) => card.textContent?.includes(name));

        // If card not found, it was removed (killed)
        if (!sessionCard) return true;

        // Check if status shows as exited
        const text = sessionCard.textContent?.toLowerCase() || '';
        const status = sessionCard.getAttribute('data-session-status');

        return status === 'exited' || text.includes('exited') || text.includes('exit');
      },
      sessionName,
      { timeout: 5000 }
    );
  }

  /**
   * Wait for network to stabilize (no pending requests)
   */
  static async forNetworkIdle(
    page: Page,
    options?: {
      timeout?: number;
      maxInflightRequests?: number;
    }
  ): Promise<void> {
    const { timeout = 3000 } = options || {};

    await page.waitForLoadState('networkidle', { timeout });
  }

  /**
   * Wait for element to stop moving (animations complete)
   */
  static async forElementStable(page: Page, selector: string): Promise<void> {
    await page.waitForFunction(
      (sel) => {
        const element = document.querySelector(sel);
        if (!element) return false;

        const rect1 = element.getBoundingClientRect();

        return new Promise((resolve) => {
          setTimeout(() => {
            const rect2 = element.getBoundingClientRect();
            resolve(
              rect1.top === rect2.top &&
                rect1.left === rect2.left &&
                rect1.width === rect2.width &&
                rect1.height === rect2.height
            );
          }, 100);
        });
      },
      selector,
      { timeout: 2000 }
    );
  }

  /**
   * Wait between actions with automatic adjustment based on system load
   */
  static async betweenActions(page: Page, minDelay = 100): Promise<void> {
    // Instead of fixed timeout, wait for UI to be responsive
    await page
      .waitForFunction(
        () => {
          // Check if there are any pending animations or transitions
          const animating = Array.from(document.querySelectorAll('*')).some((el) => {
            const style = window.getComputedStyle(el);
            const transitionDuration = Number.parseFloat(style.transitionDuration) || 0;
            const animationDuration = Number.parseFloat(style.animationDuration) || 0;
            return transitionDuration > 0 || animationDuration > 0;
          });

          return !animating;
        },
        undefined,
        { timeout: 1000 }
      )
      .catch(() => {
        // Fallback to minimum delay if check fails
        return page.waitForTimeout(minDelay);
      });
  }
}
