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
  /%\s*$/, // zsh default prompt
  /\)\s*[$#>]\s*$/, // Parenthesis-style prompts
];

// Cache for detected prompt pattern per page
const detectedPromptCache = new WeakMap<Page, RegExp>();

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

  // Try to use cached prompt pattern if available
  const cachedPrompt = detectedPromptCache.get(page);
  if (cachedPrompt && !options.customPrompts) {
    // Try cached prompt first for faster detection
    try {
      await page.waitForFunction(
        (pattern) => {
          const terminal = document.querySelector('vibe-terminal');
          if (!terminal) return false;
          const content = terminal.textContent || '';
          const lines = content.split('\n');
          const lastLine = lines[lines.length - 1] || lines[lines.length - 2] || '';
          return new RegExp(pattern).test(lastLine.trim());
        },
        cachedPrompt.source,
        { timeout: 1000 } // Quick timeout for cached pattern
      );
      return;
    } catch {
      // Cached pattern didn't work, fall back to full detection
    }
  }

  const detectedPattern = await page.waitForFunction(
    ({ patterns, interval }) => {
      return new Promise<string | null>((resolve) => {
        let attempts = 0;
        const maxAttempts = Math.floor(5000 / interval); // Dynamic based on timeout

        const checkForPrompt = () => {
          attempts++;

          // Get terminal content - try multiple selectors
          let terminal = document.querySelector('vibe-terminal');
          if (!terminal) {
            terminal = document.querySelector('.xterm-screen');
          }

          if (!terminal) {
            if (attempts < maxAttempts) {
              setTimeout(checkForPrompt, interval);
            } else {
              resolve(null);
            }
            return;
          }

          const text = terminal.textContent || '';
          const lines = text.split('\n');

          // Check last few lines for prompt (sometimes there are empty lines)
          for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3); i--) {
            const line = lines[i].trim();
            if (!line) continue;

            // Check if any prompt pattern matches
            for (const pattern of patterns) {
              const regex = new RegExp(pattern);
              if (regex.test(line)) {
                // Found a prompt, check for stability
                const currentText = terminal.textContent;
                setTimeout(() => {
                  const newText = terminal.textContent;
                  if (currentText === newText) {
                    resolve(pattern); // Return the matched pattern
                  } else if (attempts < maxAttempts) {
                    // Text changed, keep checking
                    checkForPrompt();
                  } else {
                    resolve(null);
                  }
                }, interval);
                return;
              }
            }
          }

          if (attempts < maxAttempts) {
            setTimeout(checkForPrompt, interval);
          } else {
            resolve(null);
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

  if (!detectedPattern) {
    throw new Error('Shell prompt not found within timeout');
  }

  // Cache the detected pattern for this page
  if (!options.customPrompts) {
    detectedPromptCache.set(page, new RegExp(detectedPattern));
  }
}

/**
 * Wait for command output to complete by detecting when the prompt returns
 */
export async function waitForCommandComplete(
  page: Page,
  options: WaitForShellPromptOptions = {}
): Promise<void> {
  // Get initial terminal content to detect changes
  const initialContent = await page.evaluate(() => {
    const terminal =
      document.querySelector('vibe-terminal') || document.querySelector('.xterm-screen');
    return terminal?.textContent || '';
  });

  // Wait for content to change (command started)
  await page
    .waitForFunction(
      (initial) => {
        const terminal =
          document.querySelector('vibe-terminal') || document.querySelector('.xterm-screen');
        const current = terminal?.textContent || '';
        return current !== initial;
      },
      initialContent,
      { timeout: 1000 }
    )
    .catch(() => {
      // Command might have executed very quickly
    });

  // Then wait for prompt to return
  await waitForShellPrompt(page, options);
}

/**
 * Check if terminal is at a shell prompt
 */
export async function isAtShellPrompt(page: Page, customPrompts?: RegExp[]): Promise<boolean> {
  const prompts = customPrompts || DEFAULT_PROMPTS;

  // Try cached prompt first
  const cachedPrompt = detectedPromptCache.get(page);
  if (cachedPrompt && !customPrompts) {
    const isAtCachedPrompt = await page.evaluate((pattern) => {
      const terminal =
        document.querySelector('vibe-terminal') || document.querySelector('.xterm-screen');
      if (!terminal) return false;
      const text = terminal.textContent || '';
      const lines = text.split('\n');
      const lastLine = lines[lines.length - 1] || lines[lines.length - 2] || '';
      return new RegExp(pattern).test(lastLine.trim());
    }, cachedPrompt.source);
    if (isAtCachedPrompt) return true;
  }

  return page.evaluate(
    (patterns) => {
      const terminal =
        document.querySelector('vibe-terminal') || document.querySelector('.xterm-screen');
      if (!terminal) return false;

      const text = terminal.textContent || '';
      const lines = text.split('\n');

      // Check last few lines for prompt
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3); i--) {
        const line = lines[i].trim();
        if (!line) continue;

        const hasPrompt = patterns.some((pattern) => {
          const regex = new RegExp(pattern);
          return regex.test(line);
        });

        if (hasPrompt) return true;
      }

      return false;
    },
    prompts.map((p) => p.source)
  );
}

/**
 * Clear the cached prompt pattern for a page
 */
export function clearPromptCache(page: Page): void {
  detectedPromptCache.delete(page);
}

/**
 * Get the last line before the prompt in the terminal
 */
export async function getLastLineBeforePrompt(page: Page): Promise<string> {
  return page.evaluate(() => {
    const terminal =
      document.querySelector('vibe-terminal') || document.querySelector('.xterm-screen');
    if (!terminal) return '';

    const text = terminal.textContent || '';
    const lines = text.split('\n');

    // Find the last prompt line
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line && /[$>#%❯]\s*$/.test(line)) {
        // Return the line before the prompt
        return i > 0 ? lines[i - 1].trim() : '';
      }
    }

    return '';
  });
}
