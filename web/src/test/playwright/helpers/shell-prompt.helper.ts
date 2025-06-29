import type { Page } from '@playwright/test';

// Common shell prompt patterns
const DEFAULT_PROMPTS = [
  /\$\s*$/, // Basic $ prompt
  />\s*$/, // Basic > prompt
  /#\s*$/, // Root # prompt
  /\]\$\s*$/, // Bash-style [...]$ prompt
  /\]#\s*$/, // Root bash-style [...]# prompt
  /❯\s*$/, // Modern prompt (starship, etc)
  /➜\s*$/, // Oh-my-zsh default
  /\w+@\w+.*[$#]\s*$/, // user@host:path$ format
  /\d+:\d+\s*[$>]\s*$/, // Time-based prompts
];

export interface WaitForShellPromptOptions {
  customPrompts?: RegExp[];
  timeout?: number;
  checkInterval?: number;
}

/**
 * Wait for shell prompt to appear in terminal
 * This is more reliable than hardcoded waits as it actively checks for prompt patterns
 */
export async function waitForShellPrompt(
  page: Page,
  options: WaitForShellPromptOptions = {}
): Promise<void> {
  const prompts = options.customPrompts || DEFAULT_PROMPTS;
  const timeout = options.timeout || 5000;
  const checkInterval = options.checkInterval || 100;

  await page.waitForFunction(
    ({ patterns, interval }) => {
      return new Promise<boolean>((resolve) => {
        let attempts = 0;
        const maxAttempts = 50; // Prevent infinite checks

        const checkForPrompt = () => {
          attempts++;

          // Get terminal content
          const terminal = document.querySelector('.xterm-screen');
          if (!terminal) {
            if (attempts < maxAttempts) {
              setTimeout(checkForPrompt, interval);
            } else {
              resolve(false);
            }
            return;
          }

          const text = terminal.textContent || '';
          const lines = text.split('\n');
          const lastLine = lines[lines.length - 1] || lines[lines.length - 2] || '';

          // Check if any prompt pattern matches
          const hasPrompt = patterns.some((pattern) => {
            const regex = new RegExp(pattern);
            return regex.test(lastLine.trim());
          });

          if (hasPrompt) {
            // Also check for cursor stability (no new output for a brief moment)
            const currentText = terminal.textContent;
            setTimeout(() => {
              const newText = terminal.textContent;
              if (currentText === newText) {
                resolve(true);
              } else if (attempts < maxAttempts) {
                // Text changed, keep checking
                checkForPrompt();
              } else {
                resolve(false);
              }
            }, interval);
          } else if (attempts < maxAttempts) {
            setTimeout(checkForPrompt, interval);
          } else {
            resolve(false);
          }
        };

        checkForPrompt();
      });
    },
    {
      patterns: prompts.map((p) => p.source),
      interval: checkInterval,
    },
    { timeout }
  );
}

/**
 * Wait for command output to complete by detecting when the prompt returns
 */
export async function waitForCommandComplete(
  page: Page,
  options: WaitForShellPromptOptions = {}
): Promise<void> {
  // First wait a brief moment for command to start executing
  await page.waitForTimeout(100);

  // Then wait for prompt to return
  await waitForShellPrompt(page, options);
}

/**
 * Check if terminal is at a shell prompt
 */
export async function isAtShellPrompt(page: Page, customPrompts?: RegExp[]): Promise<boolean> {
  const prompts = customPrompts || DEFAULT_PROMPTS;

  return page.evaluate(
    (patterns) => {
      const terminal = document.querySelector('.xterm-screen');
      if (!terminal) return false;

      const text = terminal.textContent || '';
      const lines = text.split('\n');
      const lastLine = lines[lines.length - 1] || lines[lines.length - 2] || '';

      return patterns.some((pattern) => {
        const regex = new RegExp(pattern);
        return regex.test(lastLine.trim());
      });
    },
    prompts.map((p) => p.source)
  );
}
