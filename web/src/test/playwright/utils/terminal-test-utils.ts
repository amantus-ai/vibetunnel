import type { Page } from '@playwright/test';

/**
 * Terminal test utilities for the custom terminal implementation
 * that uses headless xterm.js with custom DOM rendering
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Utility class pattern for test helpers
export class TerminalTestUtils {
  /**
   * Wait for terminal to be ready with content
   */
  static async waitForTerminalReady(page: Page, timeout = 5000): Promise<void> {
    // Wait for terminal component
    await page.waitForSelector('vibe-terminal', { state: 'visible', timeout });

    // The terminal container might be rendered dynamically, so check if terminal has any content
    await page.waitForFunction(
      () => {
        const terminal = document.querySelector('vibe-terminal');
        if (!terminal) return false;

        // Check if terminal has any text content (even just a prompt like "$")
        const text = terminal.textContent || '';
        return text.trim().length > 0;
      },
      { timeout }
    );
  }

  /**
   * Get terminal text content
   */
  static async getTerminalText(page: Page): Promise<string> {
    return await page.evaluate(() => {
      // First try to get text from terminal lines
      const lines = document.querySelectorAll('.terminal-line');
      if (lines.length > 0) {
        return Array.from(lines)
          .map((line) => line.textContent || '')
          .join('\n');
      }

      // Fallback to getting all text from the terminal component
      const terminal = document.querySelector('vibe-terminal');
      return terminal?.textContent || '';
    });
  }

  /**
   * Wait for prompt to appear
   */
  static async waitForPrompt(page: Page, timeout = 5000): Promise<void> {
    await page.waitForFunction(
      () => {
        const terminal = document.querySelector('vibe-terminal');
        if (!terminal) return false;

        const text = terminal.textContent || '';
        // Look for common prompt characters anywhere in the text
        // The prompt might have trailing spaces in the terminal
        return /[$>#%❯]/.test(text);
      },
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
  static async waitForText(page: Page, text: string, timeout = 5000): Promise<void> {
    await page.waitForFunction(
      (searchText) => {
        const lines = document.querySelectorAll('.terminal-line');
        const content = Array.from(lines)
          .map((l) => l.textContent || '')
          .join('\n');
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
