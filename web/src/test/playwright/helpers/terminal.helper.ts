import type { Page } from '@playwright/test';
import { SessionViewPage } from '../pages/session-view.page';
import { TestDataFactory } from '../utils/test-utils';

/**
 * Consolidated terminal helper functions for Playwright tests
 * Following best practices: no arbitrary timeouts, using web-first assertions
 */

/**
 * Wait for shell prompt to appear
 * Uses Playwright's auto-waiting instead of arbitrary timeouts
 */
export async function waitForShellPrompt(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const terminal = document.querySelector('vibe-terminal');
      const content = terminal?.textContent || '';
      // Match common shell prompts: $, #, >, %, ❯ at end of line
      return /[$>#%❯]\s*$/.test(content);
    },
    { timeout: 5000 } // Use reasonable timeout from config
  );
}

/**
 * Execute a command and verify its output
 */
export async function executeAndVerifyCommand(
  page: Page,
  command: string,
  expectedOutput?: string | RegExp
): Promise<void> {
  const sessionViewPage = new SessionViewPage(page);

  // Type and send command
  await sessionViewPage.typeCommand(command);

  // Wait for expected output if provided
  if (expectedOutput) {
    if (typeof expectedOutput === 'string') {
      await sessionViewPage.waitForOutput(expectedOutput);
    } else {
      await page.waitForFunction(
        ({ pattern }) => {
          const terminal = document.querySelector('vibe-terminal');
          const content = terminal?.textContent || '';
          return new RegExp(pattern).test(content);
        },
        { pattern: expectedOutput.source }
      );
    }
  }

  // Always wait for next prompt
  await waitForShellPrompt(page);
}

/**
 * Execute multiple commands in sequence
 */
export async function executeCommandSequence(page: Page, commands: string[]): Promise<void> {
  for (const command of commands) {
    await executeAndVerifyCommand(page, command);
  }
}

/**
 * Get the output of a command
 */
export async function getCommandOutput(page: Page, command: string): Promise<string> {
  const sessionViewPage = new SessionViewPage(page);

  // Mark current position in terminal
  const markerCommand = `echo "===MARKER-${Date.now()}==="`;
  await executeAndVerifyCommand(page, markerCommand);

  // Execute the actual command
  await executeAndVerifyCommand(page, command);

  // Get all terminal content
  const content = await sessionViewPage.getTerminalOutput();

  // Extract output between marker and next prompt
  const markerMatch = content.match(/===MARKER-\d+===/);
  if (!markerMatch) return '';

  const afterMarker = content.substring(content.indexOf(markerMatch[0]) + markerMatch[0].length);
  const lines = afterMarker.split('\n').slice(1); // Skip marker line

  // Find where our command output ends (next prompt)
  const outputLines = [];
  for (const line of lines) {
    if (/[$>#%❯]\s*$/.test(line)) break;
    outputLines.push(line);
  }

  // Remove the command echo line if present
  if (outputLines.length > 0 && outputLines[0].includes(command)) {
    outputLines.shift();
  }

  return outputLines.join('\n').trim();
}

/**
 * Interrupt a running command (Ctrl+C)
 */
export async function interruptCommand(page: Page): Promise<void> {
  await page.keyboard.press('Control+c');
  await waitForShellPrompt(page);
}

/**
 * Clear the terminal screen (Ctrl+L)
 */
export async function clearTerminal(page: Page): Promise<void> {
  await page.keyboard.press('Control+l');
  // Wait for terminal to be cleared
  await page.waitForFunction(() => {
    const terminal = document.querySelector('vibe-terminal');
    const lines = terminal?.textContent?.split('\n') || [];
    // Terminal is cleared when we have very few lines
    return lines.length < 5;
  });
}

/**
 * Generate unique test session name
 */
export function generateTestSessionName(): string {
  return TestDataFactory.sessionName('test-session');
}

/**
 * Clean up all test sessions
 */
export async function cleanupSessions(page: Page): Promise<void> {
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const killAllButton = page.locator('button:has-text("Kill All")');
    if (await killAllButton.isVisible()) {
      // Set up dialog handler before clicking
      const dialogPromise = page.waitForEvent('dialog');
      await killAllButton.click();

      const dialog = await dialogPromise;
      await dialog.accept();

      // Wait for all sessions to be marked as exited
      await page.waitForFunction(
        () => {
          const cards = document.querySelectorAll('session-card');
          return Array.from(cards).every((card) => {
            const text = card.textContent?.toLowerCase() || '';
            return text.includes('exited') || text.includes('exit');
          });
        },
        { timeout: 5000 }
      );
    }
  } catch (error) {
    // Ignore cleanup errors
    console.log('Session cleanup error (ignored):', error);
  }
}

/**
 * Assert that terminal contains specific text
 */
export async function assertTerminalContains(page: Page, text: string | RegExp): Promise<void> {
  const sessionViewPage = new SessionViewPage(page);

  if (typeof text === 'string') {
    await sessionViewPage.waitForOutput(text);
  } else {
    await page.waitForFunction(
      ({ pattern }) => {
        const terminal = document.querySelector('vibe-terminal');
        const content = terminal?.textContent || '';
        return new RegExp(pattern).test(content);
      },
      { pattern: text.source }
    );
  }
}

/**
 * Type text into the terminal without pressing Enter
 */
export async function typeInTerminal(page: Page, text: string): Promise<void> {
  const terminal = page.locator('vibe-terminal');
  await terminal.click();
  await page.keyboard.type(text);
}
