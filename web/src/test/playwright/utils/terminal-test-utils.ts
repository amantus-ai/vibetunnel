import type { Page } from '@playwright/test';

/**
 * Terminal test utilities for the custom terminal implementation
 * that uses ghostty-web with custom DOM rendering
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Utility class pattern for test helpers
export class TerminalTestUtils {
  /**
   * Wait for terminal to be ready with content
   */
  static async waitForTerminalReady(page: Page, timeout = 15000): Promise<void> {
    await page.waitForSelector('vibe-terminal', { state: 'visible', timeout });

    await page.waitForFunction(
      () => {
        const terminal = document.querySelector('vibe-terminal') as unknown as {
          getDebugText?: () => string;
          getAttribute?: (name: string) => string | null;
          textContent?: string | null;
        } | null;
        if (!terminal) return false;

        const content =
          typeof terminal.getDebugText === 'function'
            ? terminal.getDebugText()
            : terminal.textContent || '';
        if (!content) return false;
        return (
          /[$>#%❯]\s*$/m.test(content) ||
          content.includes('$') ||
          content.includes('#') ||
          content.includes('>')
        );
      },
      undefined,
      { timeout }
    );
  }

  /**
   * Get terminal text content
   */
  static async getTerminalText(page: Page): Promise<string> {
    return await page.evaluate(() => {
      const terminal = document.querySelector('vibe-terminal') as unknown as {
        getDebugText?: () => string;
        textContent?: string | null;
      } | null;
      if (!terminal) return '';

      if (typeof terminal.getDebugText === 'function') return terminal.getDebugText();
      return terminal.textContent || '';
    });
  }

  /**
   * Wait for prompt to appear
   */
  static async waitForPrompt(page: Page, timeout = 2000): Promise<void> {
    await page.waitForFunction(
      () => {
        const terminal = document.querySelector('vibe-terminal') as unknown as {
          getDebugText?: () => string;
          textContent?: string | null;
        } | null;
        if (!terminal) return false;

        const content =
          typeof terminal.getDebugText === 'function'
            ? terminal.getDebugText()
            : terminal.textContent || '';

        // Look for common prompt patterns
        // Match $ at end of line, or common prompt indicators
        return /[$>#%❯]\s*$/.test(content) || /\$\s+$/.test(content);
      },
      undefined,
      { timeout }
    );
  }

  /**
   * Type in terminal
   */
  static async typeInTerminal(
    page: Page,
    text: string,
    options?: { delay?: number }
  ): Promise<void> {
    // Click on terminal to focus
    await page.click('vibe-terminal');

    // Type with delay
    await page.keyboard.type(text, { delay: options?.delay || 50 });
  }

  /**
   * Execute command and press enter
   */
  static async executeCommand(page: Page, command: string): Promise<void> {
    await TerminalTestUtils.typeInTerminal(page, command);
    await page.keyboard.press('Enter');
  }

  /**
   * Wait for text to appear in terminal
   */
  static async waitForText(page: Page, text: string, timeout = 2000): Promise<void> {
    await page.waitForFunction(
      (searchText) => {
        const terminal = document.querySelector('vibe-terminal') as unknown as {
          getDebugText?: () => string;
          textContent?: string | null;
        } | null;
        if (!terminal) return false;

        const content =
          typeof terminal.getDebugText === 'function'
            ? terminal.getDebugText()
            : terminal.textContent || '';
        return content.includes(searchText);
      },
      text,
      { timeout }
    );
  }

  /**
   * Clear terminal
   */
  static async clearTerminal(page: Page): Promise<void> {
    await page.click('vibe-terminal');
    await page.keyboard.press('Control+l');
  }

  /**
   * Send interrupt signal
   */
  static async sendInterrupt(page: Page): Promise<void> {
    await page.click('vibe-terminal');
    await page.keyboard.press('Control+c');
  }
}
