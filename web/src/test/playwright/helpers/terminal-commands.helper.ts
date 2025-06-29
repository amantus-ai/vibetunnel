import type { Page } from '@playwright/test';
import { SessionViewPage } from '../pages/session-view.page';
import { waitForShellPrompt } from './terminal.helper';

/**
 * Executes a command and waits for specific output
 */
export async function executeAndVerifyCommand(
  page: Page,
  command: string,
  expectedOutput: string | RegExp,
  options: { timeout?: number; waitForPrompt?: boolean } = {}
): Promise<void> {
  const { timeout = 2000, waitForPrompt = true } = options;
  const sessionViewPage = new SessionViewPage(page);

  // Type the command
  await sessionViewPage.typeCommand(command);

  // Wait for the expected output
  if (typeof expectedOutput === 'string') {
    await sessionViewPage.waitForOutput(expectedOutput, { timeout });
  } else {
    await page.waitForFunction(
      (pattern) => {
        const terminal = document.querySelector('vibe-terminal');
        const content = terminal?.textContent || '';
        return new RegExp(pattern).test(content);
      },
      expectedOutput.source,
      { timeout }
    );
  }

  // Optionally wait for prompt
  if (waitForPrompt) {
    await waitForShellPrompt(page, timeout);
  }
}

/**
 * Executes multiple commands in sequence
 */
export async function executeCommandSequence(
  page: Page,
  commands: Array<string | { command: string; expectedOutput?: string; waitBetween?: number }>
): Promise<void> {
  const sessionViewPage = new SessionViewPage(page);

  for (const cmd of commands) {
    if (typeof cmd === 'string') {
      // Simple command
      await sessionViewPage.typeCommand(cmd);
      await waitForShellPrompt(page);
    } else {
      // Command with options
      await sessionViewPage.typeCommand(cmd.command);

      if (cmd.expectedOutput) {
        await sessionViewPage.waitForOutput(cmd.expectedOutput);
      }

      await waitForShellPrompt(page);

      if (cmd.waitBetween) {
        await page.waitForTimeout(cmd.waitBetween);
      }
    }
  }
}

/**
 * Executes a command and returns its output
 */
export async function getCommandOutput(
  page: Page,
  command: string,
  options: { timeout?: number; includeCommand?: boolean } = {}
): Promise<string> {
  const { timeout = 2000, includeCommand = false } = options;
  const sessionViewPage = new SessionViewPage(page);

  // Get terminal content before command
  const beforeContent = await sessionViewPage.getTerminalOutput();

  // Execute command
  await sessionViewPage.typeCommand(command);
  await waitForShellPrompt(page, timeout);

  // Get terminal content after command
  const afterContent = await sessionViewPage.getTerminalOutput();

  // Extract just the new output
  const newContent = afterContent.substring(beforeContent.length);
  const lines = newContent.split('\n');

  // Remove the command line itself unless requested
  if (!includeCommand && lines.length > 0) {
    lines.shift();
  }

  // Remove the trailing prompt line
  if (lines.length > 0 && /[$>#%❯]\s*$/.test(lines[lines.length - 1])) {
    lines.pop();
  }

  return lines.join('\n').trim();
}

/**
 * Waits for a background process to complete
 */
export async function waitForBackgroundProcess(
  page: Page,
  processIndicator: string | RegExp,
  timeout = 10000
): Promise<void> {
  await page.waitForFunction(
    (indicator) => {
      const terminal = document.querySelector('vibe-terminal');
      const content = terminal?.textContent || '';

      if (typeof indicator === 'string') {
        return !content.includes(indicator);
      } else {
        return !new RegExp(indicator).test(content);
      }
    },
    processIndicator,
    { timeout }
  );
}

/**
 * Sends interrupt signal and waits for prompt
 */
export async function interruptCommand(page: Page, timeout = 2000): Promise<void> {
  const sessionViewPage = new SessionViewPage(page);

  // Send Ctrl+C
  await sessionViewPage.sendInterrupt();

  // Wait for interrupt to be processed
  await page.waitForFunction(
    () => {
      const terminal = document.querySelector('vibe-terminal');
      const content = terminal?.textContent || '';
      return content.includes('^C') || /[$>#%❯]\s*$/.test(content);
    },
    { timeout }
  );

  // Wait for prompt to be ready
  await waitForShellPrompt(page, timeout);
}

/**
 * Executes a command with automatic retry on failure
 */
export async function executeCommandWithRetry(
  page: Page,
  command: string,
  expectedOutput: string,
  maxRetries = 3
): Promise<void> {
  let lastError: Error | undefined;

  for (let i = 0; i < maxRetries; i++) {
    try {
      await executeAndVerifyCommand(page, command, expectedOutput);
      return;
    } catch (error) {
      lastError = error as Error;

      // If not last retry, wait a bit and try again
      if (i < maxRetries - 1) {
        await page.waitForTimeout(1000);
        // Clear terminal before retry
        const sessionViewPage = new SessionViewPage(page);
        await sessionViewPage.clearTerminal();
        await waitForShellPrompt(page);
      }
    }
  }

  throw new Error(`Command failed after ${maxRetries} retries: ${lastError?.message}`);
}

/**
 * Types multi-line input (useful for heredocs or pasting)
 */
export async function typeMultilineInput(
  page: Page,
  lines: string[],
  endSequence = 'EOF'
): Promise<void> {
  for (const line of lines) {
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
  }

  if (endSequence) {
    await page.keyboard.type(endSequence);
    await page.keyboard.press('Enter');
  }
}
