/**
 * Re-export terminal functions from consolidated terminal.helper.ts
 * This file is kept for backward compatibility
 */

export {
  assertTerminalContains,
  executeAndVerifyCommand,
  executeCommandSequence,
  getCommandOutput,
  interruptCommand,
  waitForShellPrompt,
} from './terminal.helper';

// Additional terminal command utilities that weren't in terminal.helper.ts

import type { Page } from '@playwright/test';
import { executeAndVerifyCommand } from './terminal.helper';

/**
 * Execute a command with retry logic
 */
export async function executeCommandWithRetry(
  page: Page,
  command: string,
  expectedOutput: string | RegExp,
  maxRetries = 3
): Promise<void> {
  let lastError: Error | undefined;

  for (let i = 0; i < maxRetries; i++) {
    try {
      await executeAndVerifyCommand(page, command, expectedOutput);
      return;
    } catch (error) {
      lastError = error as Error;

      // If not last retry, wait for terminal to be ready
      if (i < maxRetries - 1) {
        await page.waitForSelector('vibe-terminal', { state: 'visible' });
        // Clear terminal before retry
        await page.keyboard.press('Control+l');
      }
    }
  }

  throw new Error(`Command failed after ${maxRetries} retries: ${lastError?.message}`);
}

/**
 * Wait for a background process to complete
 */
export async function waitForBackgroundProcess(page: Page, processMarker: string): Promise<void> {
  await page.waitForFunction((marker) => {
    const terminal = document.querySelector('vibe-terminal');
    const content = terminal?.textContent || '';

    // Check if process completed (by finding prompt after the marker)
    const markerIndex = content.lastIndexOf(marker);
    if (markerIndex === -1) return false;

    const afterMarker = content.substring(markerIndex);
    return /[$>#%❯]\s*$/.test(afterMarker);
  }, processMarker);
}
