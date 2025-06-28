import type { Page } from '@playwright/test';
import { TerminalTestUtils } from '../utils/terminal-test-utils';
import { TerminalUtils, TestDataFactory, WaitUtils, withRetry } from '../utils/test-utils';

/**
 * Wait for shell prompt with improved detection
 */
export async function waitForShellPrompt(page: Page, timeout = 5000) {
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
export async function waitForProcessToComplete(page: Page, processName: string, timeout = 30000) {
  await page.waitForFunction(
    (proc) => {
      const lines = document.querySelectorAll('.terminal-line');
      const text = Array.from(lines).map(l => l.textContent || '').join('\n');
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
  await withRetry(
    async () => {
      // Navigate to session list
      await page.goto('/');

      // Wait for app to load
      await page.waitForSelector('vibetunnel-app', { state: 'attached' });
      await WaitUtils.waitForNetworkIdle(page);

      // Check if we're in session view and go back to list
      const sessionView = await page.locator('session-view').count();
      if (sessionView > 0) {
        const backButton = page.locator('button:has-text("Back")').first();
        if (await backButton.isVisible()) {
          await backButton.click();
          await page.waitForSelector('session-list', { state: 'visible' });
        }
      }

      // First, clean up any exited sessions
      const cleanExitedButton = page.locator('button:has-text("Clean Exited")');
      if (await cleanExitedButton.isVisible()) {
        await cleanExitedButton.click();
        await page.waitForTimeout(1000); // Wait for cleanup to complete
      }
      
      // Check if there are any running sessions to clean up
      let sessionCards = await page.locator('session-card').count();
      
      // If no visible sessions, check for exited sessions
      if (sessionCards === 0) {
        // Look for "Show Exited" button
        const showExitedButton = page.locator('button:has-text("Show Exited")');
        if (await showExitedButton.isVisible()) {
          await showExitedButton.click();
          await page.waitForTimeout(500); // Wait for UI to update
          sessionCards = await page.locator('session-card').count();
          
          // Try clean exited again after showing them
          const cleanExitedAfterShow = page.locator('button:has-text("Clean Exited")');
          if (await cleanExitedAfterShow.isVisible()) {
            await cleanExitedAfterShow.click();
            await page.waitForTimeout(1000); // Wait for cleanup to complete
            sessionCards = await page.locator('session-card').count();
          }
        }
        
        if (sessionCards === 0) {
          return; // No sessions to clean up
        }
      }

      // Use Kill All button if available
      const killAllButton = page.locator('button:has-text("Kill All")');
      if (await killAllButton.isVisible()) {
        // Set up dialog handler before clicking
        page.once('dialog', (dialog) => dialog.accept());
        await killAllButton.click();

        // Wait for all sessions to be removed or "No active sessions" message
        await page.waitForFunction(
          () => {
            const cards = document.querySelectorAll('session-card');
            const noSessions = document.body.textContent?.includes('No active sessions');
            return cards.length === 0 || noSessions;
          },
          { timeout: 10000 }
        );
      } else {
        // Kill sessions one by one as fallback
        const cards = await page.locator('session-card').all();

        for (const card of cards.reverse()) {
          const killButton = card.locator('button:has-text("Kill")');
          if (await killButton.isVisible()) {
            // Set up dialog handler before clicking
            page.once('dialog', (dialog) => dialog.accept());
            await killButton.click();

            // Wait for card to be removed
            await card.waitFor({ state: 'detached', timeout: 5000 });
          }
        }
      }

      // Verify cleanup was successful
      await page.waitForTimeout(500); // Brief wait for UI to settle
    },
    {
      retries: 3,
      onRetry: (attempt) => console.log(`Cleanup retry attempt ${attempt}`),
    }
  );
}
