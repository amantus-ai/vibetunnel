import { TerminalTestUtils } from '../utils/terminal-test-utils';
import { WaitUtils } from '../utils/test-utils';
import { BasePage } from './base.page';

/**
 * Page object for the terminal session view, providing terminal interaction capabilities.
 *
 * This class handles all interactions within an active terminal session, including
 * command execution, output verification, terminal control operations, and navigation.
 * It wraps terminal-specific utilities to provide a clean interface for test scenarios
 * that need to interact with the terminal emulator.
 *
 * Key features:
 * - Command execution with automatic Enter key handling
 * - Terminal output reading and waiting for specific text
 * - Terminal control operations (clear, interrupt, resize)
 * - Copy/paste functionality
 * - Session navigation (back to list)
 * - Terminal state verification
 *
 * @example
 * ```typescript
 * // Execute commands and verify output
 * const sessionView = new SessionViewPage(page);
 * await sessionView.waitForTerminalReady();
 * await sessionView.typeCommand('echo "Hello World"');
 * await sessionView.waitForOutput('Hello World');
 *
 * // Control terminal
 * await sessionView.clearTerminal();
 * await sessionView.sendInterrupt(); // Ctrl+C
 * await sessionView.resizeTerminal(800, 600);
 *
 * // Navigate back
 * await sessionView.navigateBack();
 * ```
 */
export class SessionViewPage extends BasePage {
  // Selectors
  private readonly selectors = {
    terminal: 'vibe-terminal',
    terminalBuffer: 'vibe-terminal-buffer',
    sessionHeader: 'session-header',
    backButton: 'button:has-text("Back")',
    vibeTunnelLogo: 'button:has(h1:has-text("VibeTunnel"))',
  };

  private terminalSelector = this.selectors.terminal;

  async waitForTerminalReady(options?: { timeout?: number; requirePrompt?: boolean }) {
    const timeout = options?.timeout ?? (process.env.CI ? 20000 : 15000);
    const requirePrompt = options?.requirePrompt ?? true;

    // Wait for terminal element to be visible
    await this.page.waitForSelector(this.selectors.terminal, {
      state: 'visible',
      timeout,
    });

    await this.page.waitForFunction(
      ({ mustHavePrompt }) => {
        const host = document.querySelector('#session-terminal') ?? document;
        const terminal = host.querySelector('vibe-terminal') as unknown as {
          getAttribute?: (name: string) => string | null;
          getDebugText?: () => string;
          textContent?: string | null;
          shadowRoot?: ShadowRoot | null;
        } | null;
        if (!terminal) return false;

        if (terminal.getAttribute?.('data-ready') !== 'true') return false;

        if (!mustHavePrompt) return true;

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
      { mustHavePrompt: requirePrompt },
      { timeout }
    );
  }

  async typeCommand(command: string, pressEnter = true) {
    if (pressEnter) {
      await TerminalTestUtils.executeCommand(this.page, command);
    } else {
      await TerminalTestUtils.typeInTerminal(this.page, command);
    }
  }

  async waitForOutput(text: string, options?: { timeout?: number }) {
    await TerminalTestUtils.waitForText(
      this.page,
      text,
      options?.timeout || (process.env.CI ? 5000 : 2000)
    );
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
    await this.page.click(this.selectors.terminal);
    // Select all and copy
    await this.page.keyboard.press('ControlOrMeta+a');
    await this.page.keyboard.press('ControlOrMeta+c');
  }

  async pasteText(text: string) {
    await this.page.click(this.selectors.terminal);
    // Use clipboard API if available, otherwise type directly
    const clipboardAvailable = await this.page.evaluate(() => !!navigator.clipboard);

    if (clipboardAvailable) {
      try {
        await this.page.evaluate(async (textToPaste) => {
          await navigator.clipboard.writeText(textToPaste);
        }, text);
        await this.page.keyboard.press('ControlOrMeta+v');
        return;
      } catch {}
    } else {
      // Fallback: type the text directly
      await this.page.keyboard.type(text);
      return;
    }

    await this.page.keyboard.type(text);
  }

  async navigateBack() {
    // Try multiple ways to navigate back to the session list

    // 1. Try the back button in the header
    const backButton = this.page.locator(this.selectors.backButton).first();
    if (await backButton.isVisible({ timeout: 1000 })) {
      await backButton.click();
      await this.page.waitForURL('/', { timeout: process.env.CI ? 10000 : 5000 });
      return;
    }

    // 2. Try clicking on the app title/logo to go home
    const appTitle = this.page
      .locator('h1, a')
      .filter({ hasText: /VibeTunnel/i })
      .first();
    if (await appTitle.isVisible({ timeout: 1000 })) {
      await appTitle.click();
      return;
    }

    // 3. As last resort, use browser back button
    await this.page.goBack().catch(() => {
      // If browser back fails, we have to use goto
      return this.page.goto('/');
    });
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

  async clickTerminal() {
    await this.page.click(this.terminalSelector);
  }
}
