/**
 * Terminal title management utilities
 *
 * Generates and injects terminal title sequences based on working directory
 * and running command.
 */

import * as os from 'os';
import * as path from 'path';
import type { ActivityState } from './activity-detector.js';
import { PromptDetector } from './prompt-patterns.js';

// Pre-compiled regex patterns for performance
// Match cd command with optional arguments, handling newlines
// The argument capture group excludes command separators
const CD_REGEX = /^\s*cd(?:\s+([^;&|\n]+?))?(?:\s*[;&|\n]|$)/;

/**
 * Generate a terminal title sequence (OSC 2)
 *
 * @param cwd Current working directory
 * @param command Command being run
 * @param sessionName Optional session name
 * @returns Terminal title escape sequence
 */
export function generateTitleSequence(
  cwd: string,
  command: string[],
  sessionName?: string
): string {
  // Convert absolute path to use ~ for home directory
  const homeDir = os.homedir();
  const displayPath = cwd.startsWith(homeDir) ? cwd.replace(homeDir, '~') : cwd;

  // Get the command name (first element of command array)
  // Extract just the process name from the full path
  const fullCmd = command[0] || 'shell';
  const cmdName = path.basename(fullCmd);

  // Build title parts
  const parts = [displayPath, cmdName];

  // Check if session name should be included
  if (sessionName?.trim() && !isRedundantSessionName(sessionName, cmdName, displayPath)) {
    parts.push(sessionName);
  }

  // Format: path · command · session name
  const title = parts.join(' · ');

  // OSC 2 sequence: ESC ] 2 ; <title> BEL
  return `\x1B]2;${title}\x07`;
}

/**
 * Check if a session name is redundant (auto-generated and duplicates info)
 *
 * Examples of redundant names:
 * - "claude · claude" when command is "claude"
 * - "python3 (~/Projects)" when path is ~/Projects and command is python3
 * - "bash · bash" when command is "bash"
 *
 * @param sessionName The session name to check
 * @param cmdName The command name
 * @param displayPath The display path
 * @returns True if the session name is redundant and should be skipped
 */
function isRedundantSessionName(
  sessionName: string,
  cmdName: string,
  displayPath: string
): boolean {
  // Check for simple duplication patterns like "claude · claude"
  if (sessionName === `${cmdName} · ${cmdName}`) {
    return true;
  }

  // Check if session name follows auto-generated pattern: "command (path)"
  const autoGenPattern = new RegExp(`^${cmdName}\\s*\\(`);
  if (autoGenPattern.test(sessionName)) {
    return true;
  }

  // Check if session name is just the command name
  if (sessionName === cmdName) {
    return true;
  }

  return false;
}

/**
 * Extract directory change from cd command
 *
 * @param input The input command string
 * @param currentDir Current working directory
 * @returns New directory if cd command detected, null otherwise
 */
export function extractCdDirectory(input: string, currentDir: string): string | null {
  const match = input.match(CD_REGEX);

  if (!match) {
    return null;
  }

  // Handle cd without arguments (goes to home directory)
  if (!match[1]) {
    return os.homedir();
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
  // Use unified prompt detector for consistency and performance
  return PromptDetector.endsWithPrompt(data);
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
    // Simply prepend the title sequence
    return title + data;
  }

  return data;
}

/**
 * Generate a dynamic terminal title with activity indicators
 *
 * @param cwd Current working directory
 * @param command Command being run
 * @param activity Current activity state
 * @param sessionName Optional session name
 * @returns Terminal title escape sequence
 */
export function generateDynamicTitle(
  cwd: string,
  command: string[],
  activity: ActivityState,
  sessionName?: string
): string {
  const homeDir = os.homedir();
  const displayPath = cwd.startsWith(homeDir) ? cwd.replace(homeDir, '~') : cwd;
  const fullCmd = command[0] || 'shell';
  const cmdName = path.basename(fullCmd);

  // Build base parts
  const baseParts = [displayPath, cmdName];

  // Check if session name should be included
  if (sessionName?.trim() && !isRedundantSessionName(sessionName, cmdName, displayPath)) {
    baseParts.push(sessionName);
  }

  // If we have Claude-specific status, put it first
  if (activity.specificStatus) {
    // Format: status · path · command · session name
    const title = `${activity.specificStatus.status} · ${baseParts.join(' · ')}`;
    return `\x1B]2;${title}\x07`;
  }

  // Otherwise use generic activity indicator (only when active)
  if (activity.isActive) {
    // Format: ● path · command · session name
    const title = `● ${baseParts.join(' · ')}`;
    return `\x1B]2;${title}\x07`;
  }

  // When idle, no indicator - just path · command · session name
  const title = baseParts.join(' · ');

  // OSC 2 sequence: ESC ] 2 ; <title> BEL
  return `\x1B]2;${title}\x07`;
}
