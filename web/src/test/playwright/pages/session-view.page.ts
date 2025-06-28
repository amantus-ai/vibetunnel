import { TerminalTestUtils } from '../utils/terminal-test-utils';
import { TerminalUtils, WaitUtils } from '../utils/test-utils';
import { BasePage } from './base.page';

export class SessionViewPage extends BasePage {
  private terminalSelector = 'vibe-terminal';

  async waitForTerminalReady() {
    await TerminalTestUtils.waitForTerminalReady(this.page);
    await TerminalTestUtils.waitForPrompt(this.page);
  }

  async typeCommand(command: string, pressEnter = true) {
    if (pressEnter) {
      await TerminalTestUtils.executeCommand(this.page, command);
    } else {
      await TerminalTestUtils.typeInTerminal(this.page, command);
    }
  }

  async waitForOutput(text: string, options?: { timeout?: number }) {
    await TerminalTestUtils.waitForText(this.page, text, options?.timeout || 5000);
  }

  async getTerminalOutput(): Promise<string> {
    return await TerminalTestUtils.getTerminalText(this.page);
  }

  async clearTerminal() {
    await TerminalTestUtils.clearTerminal(this.page);
  }

  async sendInterrupt() {
    await TerminalTestUtils.sendInterrupt(this.page);
  }

  async resizeTerminal(width: number, height: number) {
    await this.page.setViewportSize({ width, height });
    // Wait for terminal to stabilize after resize
    await WaitUtils.waitForElementStable(this.page.locator(this.terminalSelector), {
      timeout: 2000,
    });
  }

  async copyText() {
    await this.page.click('vibe-terminal');
    // Select all and copy
    await this.page.keyboard.press('Control+a');
    await this.page.keyboard.press('Control+c');
  }

  async pasteText(text: string) {
    await this.page.click('vibe-terminal');
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
      const terminal = document.querySelector('vibe-terminal');
      const container = document.querySelector('[data-testid="terminal-container"]');
      return terminal !== null && container !== null && container.clientHeight > 0;
    });
  }

  async waitForPrompt(promptText?: string) {
    if (promptText) {
      await this.waitForOutput(promptText);
    } else {
      await TerminalTestUtils.waitForPrompt(this.page);
    }
  }

  async executeAndWait(command: string, expectedOutput: string) {
    await TerminalTestUtils.executeCommand(this.page, command);
    await this.waitForOutput(expectedOutput);
  }
}
