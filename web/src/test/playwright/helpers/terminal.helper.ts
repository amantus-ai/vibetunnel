import type { Page } from '@playwright/test';
import { TerminalTestUtils } from '../utils/terminal-test-utils';
import { TestDataFactory } from '../utils/test-utils';

/**
 * Wait for shell prompt with improved detection
 */
export async function waitForShellPrompt(page: Page, timeout = 2000) {
  // Wait for prompt without extra delay
  await TerminalTestUtils.waitForPrompt(page, timeout);
}

/**
 * Execute command and wait for next prompt
 */
export async function executeCommandAndWaitForPrompt(page: Page, command: string) {
  await TerminalTestUtils.executeCommand(page, command);
  await TerminalTestUtils.waitForPrompt(page);
}

/**
 * Get output from the last executed command
 */
export async function getLastCommandOutput(page: Page): Promise<string> {
  const fullText = await TerminalTestUtils.getTerminalText(page);
  const lines = fullText.split('\n');

  // Find the last prompt and get everything before it
  let lastPromptIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/[$>#%❯]\s*$|@.*[$>#]\s*$/.test(lines[i])) {
      lastPromptIndex = i;
      break;
    }
  }

  if (lastPromptIndex > 0) {
    // Find the previous prompt
    let prevPromptIndex = -1;
    for (let i = lastPromptIndex - 1; i >= 0; i--) {
      if (/[$>#%❯]\s*$|@.*[$>#]\s*$/.test(lines[i])) {
        prevPromptIndex = i;
        break;
      }
    }

    if (prevPromptIndex >= 0) {
      // Return output between prompts
      return lines
        .slice(prevPromptIndex + 1, lastPromptIndex)
        .join('\n')
        .trim();
    }
  }

  return '';
}

/**
 * Wait for process to complete with improved detection
 */
export async function waitForProcessToComplete(page: Page, processName: string, timeout = 2000) {
  await page.waitForFunction(
    (proc) => {
      const lines = document.querySelectorAll('.terminal-line');
      const text = Array.from(lines)
        .map((l) => l.textContent || '')
        .join('\n');
      // Check if process completed
      return (
        text.includes(`${proc}: command not found`) ||
        text.includes('exit code') ||
        text.includes('Exit') ||
        /Process exited|terminated|finished/.test(text) ||
        /[$>#%❯]\s*$/.test(text.split('\n').pop() || '')
      );
    },
    processName,
    { timeout }
  );
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
export async function cleanupSessions(page: Page) {
  // Simple approach - just navigate to root and kill all if available
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Quick check for Kill All button
    const killAllButton = page.locator('button:has-text("Kill All")');
    if (await killAllButton.isVisible({ timeout: 2000 })) {
      page.once('dialog', (dialog) => dialog.accept());
      await killAllButton.click();
      // Wait for sessions to be marked as exited
      await page
        .waitForFunction(
          () => {
            const cards = document.querySelectorAll('session-card');
            return Array.from(cards).every(
              (card) =>
                card.textContent?.toLowerCase().includes('exited') ||
                card.textContent?.toLowerCase().includes('exit')
            );
          },
          { timeout: 2000 }
        )
        .catch(() => {});
    }

    // Return quickly - don't wait for complete cleanup
  } catch (error) {
    // Ignore errors in cleanup
    console.log('Cleanup error (ignored):', error);
  }
}
