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
      const terminal = document.querySelector('vibe-terminal') as unknown as {
        getDebugText?: () => string;
        textContent?: string | null;
      } | null;
      const fallback = document.querySelector('#session-terminal') as HTMLElement | null;
      if (!terminal && !fallback) return false;

      const content =
        terminal && typeof terminal.getDebugText === 'function'
          ? terminal.getDebugText()
          : terminal?.textContent || fallback?.textContent || '';

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
    undefined,
    { timeout: 10000 } // Increased timeout for reliability
  );
}

/**
 * Wait for terminal to be ready for input
 */
export async function waitForTerminalReady(page: Page): Promise<void> {
  await page.locator('#session-terminal').waitFor({ state: 'visible' });

  // Wait for terminal initialization and prompt
  await page.waitForFunction(
    () => {
      const host = document.querySelector('#session-terminal');
      if (!host) return false;

      const term = host.querySelector('vibe-terminal') as unknown as {
        getDebugText?: () => string;
        textContent?: string | null;
      } | null;
      if (!term) return false;

      const content =
        typeof term.getDebugText === 'function' ? term.getDebugText() : term.textContent || '';
      if (!content) return false;

      const promptPatterns = [/[$>#%❯]\s*$/m, /\w+@\w+/, /bash-\d+\.\d+[$>#]/];

      return promptPatterns.some((p) => p.test(content)) || content.length > 10;
    },
    undefined,
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
  const terminal = page.locator('vibe-terminal');
  await terminal.click();

  // Use a unique marker to robustly detect command completion across shells/prompts.
  // Avoids fragile "prompt must be at end of buffer" logic.
  const marker = `__VT_DONE_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
  const fullCommand = `${command}; echo "${marker}"`;

  // Execute command
  await page.keyboard.type(fullCommand);
  await page.keyboard.press('Enter');

  // Wait for command completion: marker + expected output (if any).
  await page.waitForFunction(
    ({ expectedText, expectRegex, markerText }) => {
      const term = document.querySelector('vibe-terminal') as unknown as {
        getDebugText?: () => string;
        textContent?: string | null;
      } | null;
      const current =
        term && typeof term.getDebugText === 'function'
          ? term.getDebugText()
          : term?.textContent || '';

      // Check for expected output if provided
      if (expectedText && !current.includes(expectedText)) return false;
      if (expectRegex) {
        const regex = new RegExp(expectRegex);
        if (!regex.test(current)) return false;
      }

      return current.includes(markerText);
    },
    {
      expectedText: typeof expectedOutput === 'string' ? expectedOutput : null,
      expectRegex: expectedOutput instanceof RegExp ? expectedOutput.source : null,
      markerText: marker,
    },
    { timeout: 20000 }
  );

  // Finally, wait for a prompt to reappear (best-effort). Some environments may be noisy.
  await waitForShellPrompt(page);
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
    const terminal = document.querySelector('vibe-terminal') as unknown as {
      getDebugText?: () => string;
      textContent?: string | null;
    } | null;
    const text =
      terminal && typeof terminal.getDebugText === 'function'
        ? terminal.getDebugText()
        : terminal?.textContent || '';
    const lines = text.split('\n');
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
        undefined,
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
        const terminal = document.querySelector('vibe-terminal') as unknown as {
          getDebugText?: () => string;
          textContent?: string | null;
        } | null;
        const content =
          terminal && typeof terminal.getDebugText === 'function'
            ? terminal.getDebugText()
            : terminal?.textContent || '';
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
