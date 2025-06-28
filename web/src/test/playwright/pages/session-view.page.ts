import { BasePage } from './base.page';

export class SessionViewPage extends BasePage {
  private terminalSelector = 'vibe-terminal';
  private terminalScreenSelector = '.xterm-screen';
  private terminalTextLayerSelector = '.xterm-text-layer';

  async waitForTerminalReady() {
    // Wait for terminal component to be visible
    await this.page.waitForSelector(this.terminalSelector, { state: 'visible' });

    // For web sessions, the terminal might take longer to initialize
    // Try to wait for xterm, but don't fail if it doesn't appear immediately
    try {
      await this.page.waitForSelector(`${this.terminalSelector} .xterm`, { 
        state: 'visible',
        timeout: 5000 
      });
    } catch (e) {
      // Terminal component exists but xterm might not be initialized yet
      // This can happen with web sessions that are still connecting
      console.log('Note: xterm not immediately visible, continuing...');
    }

    // Wait a bit for terminal to be fully interactive
    await this.page.waitForTimeout(2000);
  }

  async typeCommand(command: string, pressEnter = true) {
    // Click on the terminal component to focus it
    try {
      // Try clicking the xterm screen first
      await this.page.click(this.terminalScreenSelector);
    } catch (e) {
      // If xterm screen not available, click the terminal component itself
      await this.page.click(this.terminalSelector);
    }

    // Type the command
    await this.page.keyboard.type(command, { delay: 50 });

    // Press Enter if requested
    if (pressEnter) {
      await this.page.keyboard.press('Enter');
    }
  }

  async waitForOutput(text: string, options?: { timeout?: number }) {
    await this.page.waitForFunction(
      (expectedText) => {
        const terminal = document.querySelector('.xterm-text-layer');
        return terminal?.textContent?.includes(expectedText);
      },
      text,
      { timeout: options?.timeout || 10000 }
    );
  }

  async getTerminalOutput(): Promise<string> {
    return await this.page.evaluate(() => {
      const terminal = document.querySelector('.xterm-text-layer');
      return terminal?.textContent || '';
    });
  }

  async clearTerminal() {
    await this.page.click(this.terminalScreenSelector);
    // Ctrl+L to clear terminal
    await this.page.keyboard.press('Control+l');
  }

  async sendInterrupt() {
    await this.page.click(this.terminalScreenSelector);
    // Ctrl+C to interrupt
    await this.page.keyboard.press('Control+c');
  }

  async resizeTerminal(width: number, height: number) {
    await this.page.setViewportSize({ width, height });
    // Wait for resize to take effect
    await this.page.waitForTimeout(500);
  }

  async copyText() {
    await this.page.click(this.terminalScreenSelector);
    // Select all and copy
    await this.page.keyboard.press('Control+a');
    await this.page.keyboard.press('Control+c');
  }

  async pasteText(text: string) {
    await this.page.click(this.terminalScreenSelector);
    // Use clipboard API if available, otherwise type directly
    const clipboardAvailable = await this.page.evaluate(() => !!navigator.clipboard);

    if (clipboardAvailable) {
      await this.page.evaluate(async (textToPaste) => {
        await navigator.clipboard.writeText(textToPaste);
      }, text);
      await this.page.keyboard.press('Control+v');
    } else {
      // Fallback: type the text directly
      await this.page.keyboard.type(text);
    }
  }

  async navigateBack() {
    // Click the back button in the header or sidebar
    const backButton = this.page
      .locator('button')
      .filter({ hasText: /back|×/i })
      .first();
    if (await backButton.isVisible()) {
      await backButton.click();
    } else {
      // If no back button, navigate to root
      await this.page.goto('/');
    }
  }

  async isTerminalActive(): Promise<boolean> {
    return await this.page.evaluate(() => {
      const terminal = document.querySelector('.xterm-screen');
      return terminal !== null && terminal.clientHeight > 0;
    });
  }

  async waitForPrompt(promptText = '$') {
    await this.waitForOutput(promptText);
  }

  async executeAndWait(command: string, expectedOutput: string) {
    await this.typeCommand(command);
    await this.waitForOutput(expectedOutput);
  }
}
