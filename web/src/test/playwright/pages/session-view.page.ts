import { BasePage } from './base.page';

export class SessionViewPage extends BasePage {
  private terminalSelector = 'vibe-terminal';
  private terminalScreenSelector = '.xterm-screen';
  private terminalTextLayerSelector = '.xterm-text-layer';

  async waitForTerminalReady() {
    // Wait for terminal component to be visible
    await this.page.waitForSelector(this.terminalSelector, { state: 'visible' });

    // Wait for xterm to be initialized inside the terminal
    await this.page.waitForSelector(`${this.terminalSelector} .xterm`, { state: 'visible' });

    // Wait a bit for terminal to be fully interactive
    await this.page.waitForTimeout(2000);
  }

  async typeCommand(command: string, pressEnter = true) {
    // Focus the terminal screen
    await this.page.click(this.terminalScreenSelector);

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
