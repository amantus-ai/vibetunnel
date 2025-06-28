/**
 * Terminal title management utilities
 *
 * Generates and injects terminal title sequences based on working directory
 * and running command.
 */

import * as os from 'os';
import * as path from 'path';

/**
 * Generate a terminal title sequence (OSC 2)
 *
 * @param cwd Current working directory
 * @param command Command being run
 * @returns Terminal title escape sequence
 */
export function generateTitleSequence(cwd: string, command: string[]): string {
  // Convert absolute path to use ~ for home directory
  const homeDir = os.homedir();
  const displayPath = cwd.startsWith(homeDir) ? cwd.replace(homeDir, '~') : cwd;

  // Get the command name (first element of command array)
  const cmdName = command[0] || 'shell';

  // Format: path — command
  const title = `${displayPath} — ${cmdName}`;

  // OSC 2 sequence: ESC ] 2 ; <title> BEL
  return `\x1B]2;${title}\x07`;
}

/**
 * Extract directory change from cd command
 *
 * @param input The input command string
 * @param currentDir Current working directory
 * @returns New directory if cd command detected, null otherwise
 */
export function extractCdDirectory(input: string, currentDir: string): string | null {
  // Match various cd patterns - handle newlines at the end
  const cdRegex = /^\s*cd\s+(.+?)(?:\s*[;&|\n]|$)/;
  const match = input.match(cdRegex);

  if (!match) {
    return null;
  }

  let targetDir = match[1].trim();

  // Remove quotes if present
  if (
    (targetDir.startsWith('"') && targetDir.endsWith('"')) ||
    (targetDir.startsWith("'") && targetDir.endsWith("'"))
  ) {
    targetDir = targetDir.slice(1, -1);
  }

  // Handle special cases
  if (targetDir === '-') {
    // cd - (return to previous directory) - we can't track this accurately
    return null;
  }

  if (!targetDir || targetDir === '~') {
    return os.homedir();
  }

  if (targetDir.startsWith('~/')) {
    return path.join(os.homedir(), targetDir.slice(2));
  }

  // Resolve relative paths
  if (!path.isAbsolute(targetDir)) {
    return path.resolve(currentDir, targetDir);
  }

  return targetDir;
}

/**
 * Check if we should inject a title update
 *
 * @param data The terminal output data
 * @returns True if this looks like a good time to inject a title
 */
export function shouldInjectTitle(data: string): boolean {
  // Look for common shell prompt patterns that indicate command completion
  // This is a heuristic approach - not perfect but works for most shells

  // Common prompt endings
  const promptPatterns = [
    /\$\s*$/, // $ prompt
    />\s*$/, // > prompt
    /#\s*$/, // # prompt (root)
    /❯\s*$/, // Modern prompt arrows
    /➜\s*$/, // Another common arrow
    /\]\$\s*$/, // Bracketed prompts like [user@host]$
    /\]#\s*$/, // Bracketed root prompts
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Escape sequences are required for terminal prompts
    /\$\s*\x1B\[/, // Prompt followed by escape sequence
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Escape sequences are required for terminal prompts
    />\s*\x1B\[/, // Prompt followed by escape sequence
  ];

  return promptPatterns.some((pattern) => pattern.test(data));
}

/**
 * Inject title sequence into terminal output if appropriate
 *
 * @param data The terminal output data
 * @param title The title sequence to inject
 * @returns Data with title sequence injected if appropriate
 */
export function injectTitleIfNeeded(data: string, title: string): string {
  if (shouldInjectTitle(data)) {
    // Inject title sequence before the prompt
    // Find the last line that contains the prompt
    const lines = data.split('\n');
    const _lastLineIndex = lines.length - 1;

    // Insert title sequence at the beginning of the output
    return title + data;
  }

  return data;
}
