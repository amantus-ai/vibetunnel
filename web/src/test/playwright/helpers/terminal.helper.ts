import type { Page } from '@playwright/test';
import { SessionViewPage } from '../pages/session-view.page';
import { TestDataFactory } from '../utils/test-utils';

/**
 * Consolidated terminal helper functions for Playwright tests
 * Following best practices: no arbitrary timeouts, using web-first assertions
 */

/**
 * Wait for shell prompt to appear with enhanced detection
 * Uses Playwright's auto-waiting instead of arbitrary timeouts
 */
export async function waitForShellPrompt(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const terminal =
        document.querySelector('#session-terminal') || document.querySelector('vibe-terminal');
      if (!terminal) return false;

      // Check the terminal container first
      const container = terminal.querySelector('#terminal-container');
      const containerContent = container?.textContent || '';

      // Fall back to terminal content
      const content = terminal.textContent || containerContent;

      // Enhanced prompt detection patterns
      const promptPatterns = [
        /[$>#%❯]\s*$/, // Basic prompts at end
        /\w+@\w+.*[$>#%❯]\s*$/, // user@host prompts
        /bash-\d+\.\d+[$>#]\s*$/, // Bash version prompts
        /][$>#%❯]\s*$/, // Bracketed prompts
        /~\s*[$>#%❯]\s*$/, // Home directory prompts
      ];

      return (
        promptPatterns.some((pattern) => pattern.test(content)) ||
        (content.length > 10 && /[$>#%❯]/.test(content))
      );
    },
    { timeout: 10000 } // Increased timeout for reliability
  );
}

/**
 * Wait for terminal to be ready for input
 */
export async function waitForTerminalReady(page: Page): Promise<void> {
  const terminal = page.locator('#session-terminal');

  // Ensure terminal is visible and clickable
  await terminal.waitFor({ state: 'visible' });

  // Wait for terminal initialization and prompt
  await page.waitForFunction(
    () => {
      const term = document.querySelector('#session-terminal');
      if (!term) return false;

      const content = term.textContent || '';
      const hasContent = content.length > 5;
      const hasPrompt = /[$>#%❯]/.test(content);

      return hasContent && hasPrompt;
    },
    { timeout: 15000 }
  );
}

/**
 * Execute a command with intelligent waiting (modern approach)
 * Avoids arbitrary timeouts by waiting for actual command completion
 */
export async function executeCommandIntelligent(
  page: Page,
  command: string,
  expectedOutput?: string | RegExp
): Promise<void> {
  // Get terminal element
  const terminal = page.locator('#session-terminal');
  await terminal.click();

  // Capture current terminal state before command
  const beforeContent = await terminal.textContent();

  // Execute command
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');

  // Wait for command completion with intelligent detection
  await page.waitForFunction(
    ({ before, expectedText, expectRegex }) => {
      const term = document.querySelector('#session-terminal');
      const current = term?.textContent || '';

      // Command must have completed (content changed)
      if (current === before) return false;

      // Check for expected output if provided
      if (expectedText && !current.includes(expectedText)) return false;
      if (expectRegex) {
        const regex = new RegExp(expectRegex);
        if (!regex.test(current)) return false;
      }

      // Must end with a new prompt (command completed)
      return /[$>#%❯]\s*$/.test(current);
    },
    {
      before: beforeContent,
      expectedText: typeof expectedOutput === 'string' ? expectedOutput : null,
      expectRegex: expectedOutput instanceof RegExp ? expectedOutput.source : null,
    },
    { timeout: 15000 }
  );
}

/**
 * Execute a command and verify its output (legacy function for compatibility)
 */
export async function executeAndVerifyCommand(
  page: Page,
  command: string,
  expectedOutput?: string | RegExp
): Promise<void> {
  // Use the new intelligent method
  await executeCommandIntelligent(page, command, expectedOutput);
}

/**
 * Execute multiple commands in sequence with intelligent waiting
 */
export async function executeCommandSequence(page: Page, commands: string[]): Promise<void> {
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];
    console.log(`Executing command ${i + 1}/${commands.length}: ${command}`);
    await executeCommandIntelligent(page, command);
  }
}

/**
 * Execute commands with outputs for verification
 */
export async function executeCommandsWithExpectedOutputs(
  page: Page,
  commandsWithOutputs: Array<{ command: string; expectedOutput?: string | RegExp }>
): Promise<void> {
  for (let i = 0; i < commandsWithOutputs.length; i++) {
    const { command, expectedOutput } = commandsWithOutputs[i];
    console.log(`Executing command ${i + 1}/${commandsWithOutputs.length}: ${command}`);
    await executeCommandIntelligent(page, command, expectedOutput);
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
 * IMPORTANT: Only cleans up sessions that start with "test-" to avoid killing the VibeTunnel session running Claude Code
 */
export async function cleanupSessions(page: Page): Promise<void> {
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // NEVER use Kill All button as it would kill ALL sessions including
    // the VibeTunnel session that Claude Code is running in!
    // Instead, find and kill only test sessions individually
    const testSessions = page.locator('session-card').filter({ hasText: /^test-/i });
    const count = await testSessions.count();

    if (count > 0) {
      console.log(`Found ${count} test sessions to cleanup`);

      // Kill each test session individually
      for (let i = 0; i < count; i++) {
        const session = testSessions.nth(0); // Always get first as they get removed
        const sessionName = await session.locator('.text-sm').first().textContent();

        // Double-check this is a test session
        if (sessionName?.toLowerCase().startsWith('test-')) {
          const killButton = session.locator('[data-testid="kill-session-button"]');
          if (await killButton.isVisible({ timeout: 500 })) {
            await killButton.click();
            await page.waitForTimeout(500); // Wait for session to be removed
          }
        }
      }

      // Wait for all test sessions to be marked as exited
      await page.waitForFunction(
        () => {
          const cards = document.querySelectorAll('session-card');
          return Array.from(cards).every((card) => {
            const nameElement = card.querySelector('.text-sm');
            const name = nameElement?.textContent || '';
            // Only check test sessions
            if (!name.toLowerCase().startsWith('test-')) return true;
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
