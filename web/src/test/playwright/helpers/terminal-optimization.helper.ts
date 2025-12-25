import type { Page } from '@playwright/test';

/**
 * Optimized terminal helpers for faster and more reliable tests
 */

/**
 * Wait for terminal to be ready with optimized checks
 */
export async function waitForTerminalReady(page: Page, timeout = 10000): Promise<void> {
  // First, wait for the terminal element - reduced timeout
  await page.waitForSelector('vibe-terminal', {
    state: 'attached',
    timeout: Math.min(timeout, 5000),
  });

  // Combine all checks into one efficient waitForFunction
  await page.waitForFunction(
    () => {
      const term = document.querySelector('vibe-terminal') as unknown as {
        getDebugText?: () => string;
        getAttribute?: (name: string) => string | null;
      } | null;
      if (!term) return false;

      if (term.getAttribute?.('data-ready') !== 'true') return false;
      if (typeof term.getDebugText !== 'function') return false;

      const content = term.getDebugText();
      if (!content) return false;

      // Prompt heuristics
      return (
        /[$>#%❯]\s*$/m.test(content) ||
        content.includes('$') ||
        content.includes('#') ||
        content.includes('>')
      );
    },
    undefined,
    { timeout, polling: 50 } // Reduced polling interval for faster detection
  );
}

/**
 * Type a command in the terminal with optimized input
 */
export async function typeCommand(page: Page, command: string): Promise<void> {
  // Focus terminal first
  const terminal = page.locator('vibe-terminal');
  await terminal.click();

  // Type the entire command at once
  await page.keyboard.type(command);

  // Press Enter
  await page.keyboard.press('Enter');
}

/**
 * Get terminal content reliably
 */
export async function getTerminalContent(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const terminal = document.querySelector('vibe-terminal') as unknown as {
      getDebugText?: () => string;
      textContent?: string | null;
    } | null;
    if (!terminal) return '';

    if (typeof terminal.getDebugText === 'function') return terminal.getDebugText();
    return terminal.textContent || '';
  });
}

/**
 * Wait for specific output with fallback strategies
 */
export async function waitForOutput(
  page: Page,
  expected: string | RegExp,
  timeout = 3000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const content = await getTerminalContent(page);

    if (typeof expected === 'string') {
      if (content.includes(expected)) return;
    } else {
      if (expected.test(content)) return;
    }

    await page.waitForTimeout(50);
  }

  // If we get here, output wasn't found
  const currentContent = await getTerminalContent(page);
  throw new Error(`Expected output not found. Current content: ${currentContent.slice(-200)}`);
}

/**
 * Execute command and wait for completion (optimized)
 */
export async function executeCommand(
  page: Page,
  command: string,
  waitForPrompt = true
): Promise<void> {
  // Ensure terminal is focused
  const terminal = page.locator('vibe-terminal');
  await terminal.click();

  // Get current content to detect changes
  const contentBefore = await getTerminalContent(page);

  await typeCommand(page, command);

  if (waitForPrompt) {
    // Wait for content to change (command output)
    await page.waitForFunction(
      (before) => {
        const term = document.querySelector('vibe-terminal') as unknown as {
          getDebugText?: () => string;
          textContent?: string | null;
        } | null;
        const currentContent =
          term && typeof term.getDebugText === 'function'
            ? term.getDebugText()
            : term?.textContent || '';
        return currentContent !== before && currentContent.length > before.length;
      },
      contentBefore,
      { timeout: 5000 }
    );

    // Wait for the output to appear after pressing Enter
    await page.waitForTimeout(2000);
  }
}

/**
 * Clear terminal for clean state
 */
export async function clearTerminal(page: Page): Promise<void> {
  const terminal = page.locator('vibe-terminal');
  await terminal.click();

  // Use Ctrl+L to clear
  await page.keyboard.press('Control+l');
  await page.waitForTimeout(100);
}

/**
 * Verify terminal contains expected text
 */
export async function assertTerminalContains(
  page: Page,
  expected: string,
  timeout = 2000
): Promise<void> {
  try {
    await waitForOutput(page, expected, timeout);
  } catch (_error) {
    const content = await getTerminalContent(page);
    throw new Error(`Terminal does not contain "${expected}". Content: ${content}`);
  }
}

/**
 * Execute command and verify output
 */
export async function executeAndVerifyCommand(
  page: Page,
  command: string,
  expectedOutput?: string | RegExp,
  timeout = 3000
): Promise<void> {
  await executeCommand(page, command);

  if (expectedOutput) {
    await waitForOutput(page, expectedOutput, timeout);
  }
}

/**
 * Wait for terminal to be busy (no prompt)
 */
export async function waitForTerminalBusy(page: Page, timeout = 2000): Promise<void> {
  await page.waitForFunction(
    () => {
      const terminal = document.querySelector('vibe-terminal') as unknown as {
        getDebugText?: () => string;
        textContent?: string | null;
      } | null;
      const content =
        terminal && typeof terminal.getDebugText === 'function'
          ? terminal.getDebugText()
          : terminal?.textContent || '';
      // Terminal is busy if there's no prompt at the end
      return !content.match(/[$>#%❯]\s*$/m);
    },
    undefined,
    { timeout }
  );
}

/**
 * Interrupt a running command (Ctrl+C)
 */
export async function interruptCommand(page: Page): Promise<void> {
  await page.keyboard.press('Control+c');
  // Wait for prompt to appear
  await page.waitForFunction(
    () => {
      const terminal = document.querySelector('vibe-terminal') as unknown as {
        getDebugText?: () => string;
        textContent?: string | null;
      } | null;
      const content =
        terminal && typeof terminal.getDebugText === 'function'
          ? terminal.getDebugText()
          : terminal?.textContent || '';
      return content.match(/[$>#%❯]\s*$/m) !== null;
    },
    undefined,
    { timeout: 3000 }
  );
}

/**
 * Execute multiple commands in sequence
 */
export async function executeCommandSequence(page: Page, commands: string[]): Promise<void> {
  for (const command of commands) {
    await executeCommand(page, command);
    // Brief wait between commands
    await page.waitForTimeout(100);
  }
}

/**
 * Get command output
 */
export async function getCommandOutput(page: Page, command: string): Promise<string> {
  // Mark current position
  const marker = `===MARKER-${Date.now()}===`;
  await executeCommand(page, `echo "${marker}"`);

  // Execute actual command
  await executeCommand(page, command);

  // Get terminal content
  const content = await getTerminalContent(page);

  // Extract output between marker and next prompt
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) return '';

  // Find the command after the marker
  const afterMarker = content.substring(markerIndex + marker.length);
  const commandIndex = afterMarker.indexOf(command);
  if (commandIndex === -1) return '';

  // Start after the command
  const afterCommand = afterMarker.substring(commandIndex + command.length);

  // Find the next prompt (look for common prompt patterns)
  const promptMatch = afterCommand.match(/\s+([$>#%❯])\s+/);
  if (!promptMatch) return afterCommand.trim();

  // Extract text between command and next prompt
  const output = afterCommand.substring(0, promptMatch.index).trim();

  // Clean up any leading/trailing whitespace or prompt characters
  return output.replace(/^[$>#%❯]\s*/, '').trim();
}

/**
 * Get terminal dimensions
 */
export async function getTerminalDimensions(page: Page): Promise<{
  cols: number;
  rows: number;
  actualCols: number;
  actualRows: number;
}> {
  return await page.evaluate(() => {
    const terminal = document.querySelector('vibe-terminal') as unknown as {
      getDebugText?: () => string;
      textContent?: string | null;
    } | null;
    if (!terminal) {
      return { cols: 0, rows: 0, actualCols: 0, actualRows: 0 };
    }

    // Get terminal content and estimate dimensions
    const content =
      typeof terminal.getDebugText === 'function'
        ? terminal.getDebugText()
        : terminal.textContent || '';
    const lines = content.split('\n');
    const rows = lines.length || 24;
    const cols = Math.max(...lines.map((l) => l.length)) || 80;

    return {
      cols,
      rows,
      actualCols: cols,
      actualRows: rows,
    };
  });
}

/**
 * Wait for terminal resize
 */
export async function waitForTerminalResize(
  page: Page,
  initialDimensions: { cols: number; rows: number },
  timeout = 3000
): Promise<{ cols: number; rows: number; actualCols: number; actualRows: number }> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const currentDimensions = await getTerminalDimensions(page);

    if (
      currentDimensions.cols !== initialDimensions.cols ||
      currentDimensions.rows !== initialDimensions.rows
    ) {
      return currentDimensions;
    }

    await page.waitForTimeout(100);
  }

  // Return current dimensions even if no change detected
  return await getTerminalDimensions(page);
}

/**
 * Execute command with retry
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
      await clearTerminal(page);
      await executeAndVerifyCommand(page, command, expectedOutput);
      return;
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        await page.waitForTimeout(500);
      }
    }
  }

  throw new Error(`Command failed after ${maxRetries} retries: ${lastError?.message}`);
}
