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
  static async waitForTerminalReady(page: Page, timeout = 2000): Promise<void> {
    // Wait for terminal component
    await page.waitForSelector('vibe-terminal', { state: 'visible', timeout });

    // For server-side terminals, wait for the component to be fully initialized
    // The content will come through WebSocket/SSE
    await page.waitForFunction(
      () => {
        const terminal = document.querySelector('vibe-terminal');
        if (!terminal) {
          return false;
        }

        // Check if terminal has been initialized (has shadow root or content)
        const hasContent = terminal.textContent && terminal.textContent.trim().length > 0;
        const hasShadowRoot = !!terminal.shadowRoot;
        const hasXterm = !!terminal.querySelector('.xterm');

        // Terminal is ready if it has any of these
        return hasContent || hasShadowRoot || hasXterm;
      },
      { timeout }
    );
  }

  /**
   * Get terminal text content
   */
  static async getTerminalText(page: Page): Promise<string> {
    return await page.evaluate(() => {
      const terminal = document.querySelector('vibe-terminal');
      if (!terminal) return '';

      // Look for the terminal container where content is rendered
      const container = terminal.querySelector('#terminal-container');
      if (container?.textContent) {
        return container.textContent;
      }

      // Try multiple selectors for terminal content
      // 1. Look for xterm screen
      const screen = terminal.querySelector('.xterm-screen');
      if (screen?.textContent) {
        return screen.textContent;
      }

      // 2. Look for terminal lines
      const lines = terminal.querySelectorAll('.terminal-line, .xterm-rows > div');
      if (lines.length > 0) {
        return Array.from(lines)
          .map((line) => line.textContent || '')
          .join('\n');
      }

      // 3. Fallback to all text content
      return terminal.textContent || '';
    });
  }

  /**
   * Wait for prompt to appear
   */
  static async waitForPrompt(page: Page, timeout = 2000): Promise<void> {
    await page.waitForFunction(
      () => {
        const terminal = document.querySelector('vibe-terminal');
        if (!terminal) return false;

        // Check the terminal container first
        const container = terminal.querySelector('#terminal-container');
        const containerContent = container?.textContent || '';

        // Fall back to terminal content
        const content = terminal.textContent || containerContent;

        // Look for common prompt patterns
        // Match $ at end of line, or common prompt indicators
        return /[$>#%❯]\s*$/.test(content) || /\$\s+$/.test(content);
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
  static async waitForText(page: Page, text: string, timeout = 2000): Promise<void> {
    await page.waitForFunction(
      (searchText) => {
        const terminal = document.querySelector('vibe-terminal');
        if (!terminal) return false;

        // Check the terminal container first
        const container = terminal.querySelector('#terminal-container');
        if (container?.textContent?.includes(searchText)) {
          return true;
        }

        // Fall back to checking all terminal content
        const content = terminal.textContent || '';
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
