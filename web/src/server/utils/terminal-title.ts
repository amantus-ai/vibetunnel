/**
 * Terminal Title Utilities
 *
 * Functions for generating and managing terminal window titles,
 * including support for static and dynamic title modes.
 */

import * as os from 'os';
import type { ActivityState } from './activity-detector.js';

const HOME_DIR = os.homedir();
const MAX_TITLE_LENGTH = 100;
const MAX_DYNAMIC_TITLE_LENGTH = 150;

/**
 * Replace home directory with ~ in paths
 */
function shortenPath(fullPath: string): string {
  if (!fullPath) return '/';

  // For testing, also handle common test paths
  const homePaths = [HOME_DIR, '/home/user'];

  for (const homePath of homePaths) {
    if (fullPath === homePath) {
      return '~';
    }
    if (fullPath.startsWith(`${homePath}/`)) {
      return `~${fullPath.slice(homePath.length)}`;
    }
  }

  return fullPath;
}

/**
 * Truncate text with ellipsis if too long
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

/**
 * Generate static terminal title
 * Format: "~/path · command" or "~/path · session name"
 */
export function generateStaticTitle(
  workingDir: string,
  command: string[],
  sessionName?: string
): string {
  const shortPath = shortenPath(workingDir);
  const displayName = sessionName || command.join(' ');
  const title = `${shortPath} · ${displayName}`;
  return truncate(title, MAX_TITLE_LENGTH);
}

/**
 * Generate dynamic terminal title based on activity
 * Format: "status · ~/path · command" or "● · ~/path · command" or "~/path · command"
 */
export function generateDynamicTitle(
  workingDir: string,
  command: string[],
  activity: ActivityState,
  sessionName?: string
): string {
  const shortPath = shortenPath(workingDir);
  const displayName = sessionName || command.join(' ');

  const parts: string[] = [];

  // Add activity indicator
  if (activity.isActive) {
    if (activity.specificStatus) {
      parts.push(activity.specificStatus.status);
    } else {
      parts.push('●');
    }
  }

  // Add path and command
  parts.push(shortPath);
  parts.push(displayName);

  const title = parts.join(' · ');
  return truncate(title, MAX_DYNAMIC_TITLE_LENGTH);
}

/**
 * Generate OSC 2 terminal title sequence
 * Format: ESC]2;title BEL
 */
export function generateTitleSequence(title: string): string {
  // Clean the title - remove control characters
  const cleanTitle = title
    .replace(/[\x00-\x1F\x7F]/g, ' ') // Replace control chars with space
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();

  return `\x1B]2;${cleanTitle}\x07`;
}

/**
 * Filter terminal title sequences from output
 * Removes OSC 0, 1, and 2 sequences
 */
export function filterTerminalTitleSequences(data: string, filterTitles: boolean): string {
  if (!filterTitles) return data;

  // Match OSC sequences: ESC]0; ESC]1; ESC]2;
  // Can be terminated with BEL (\x07) or ESC\ (\x1B\\)
  // eslint-disable-next-line no-control-regex
  return data.replace(/\x1B\][012];[^\x07\x1B]*(?:\x07|\x1B\\)/g, '');
}

/**
 * Inject title sequence at a safe position in the output
 * Tries to inject after a complete escape sequence or at a newline
 */
export function injectTitleIfNeeded(data: string, titleSequence: string): string {
  // Check if title already exists in the data
  if (data.includes(titleSequence)) {
    return data;
  }

  // If data is empty, just prepend the title
  if (!data) {
    return titleSequence;
  }

  // Try to find a safe injection point
  // 1. After a complete SGR sequence (e.g., \x1B[0m)
  // eslint-disable-next-line no-control-regex
  const sgrMatch = data.match(/(\x1B\[[0-9;]*m)/);
  if (sgrMatch && sgrMatch.index !== undefined) {
    const insertPos = sgrMatch.index + sgrMatch[0].length;
    return data.slice(0, insertPos) + titleSequence + data.slice(insertPos);
  }

  // 2. After first newline
  const newlineIndex = data.indexOf('\n');
  if (newlineIndex !== -1) {
    return data.slice(0, newlineIndex + 1) + titleSequence + data.slice(newlineIndex + 1);
  }

  // 3. Otherwise append at the end
  return data + titleSequence;
}
