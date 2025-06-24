import * as os from 'os';
import * as path from 'path';

/**
 * Abbreviate a file path to make it more readable
 * Examples:
 *   /Users/john/Projects/myproject -> ~/Projects/myproject
 *   /Users/john/Development/vibetunnel/web -> ~/Dev/vibetunnel/web
 *   /very/long/path/to/some/directory -> …/some/directory
 */
export function abbreviatePath(fullPath: string): string {
  if (!fullPath) return '';

  const homedir = os.homedir();
  let abbreviated = fullPath;

  // Replace home directory with ~
  if (fullPath.startsWith(homedir)) {
    abbreviated = `~${fullPath.slice(homedir.length)}`;
  }

  // Common abbreviations
  abbreviated = abbreviated
    .replace('/Development/', '/Dev/')
    .replace('/Documents/', '/Docs/')
    .replace('/Applications/', '/Apps/');

  // If still long, show only last 2 path components
  const parts = abbreviated.split('/').filter((p) => p);
  if (parts.length > 3) {
    return `…/${parts.slice(-2).join('/')}`;
  }

  return abbreviated;
}

/**
 * Generate a human-readable session name
 * Format: commandName (abbreviatedPath)
 * Examples:
 *   claude (~/Dev/vibetunnel/web)
 *   bash (~/Projects/myapp)
 *   python3 (~)
 */
export function generateSessionName(command: string[], workingDir: string): string {
  const commandName = path.basename(command[0]);
  const abbrevCwd = abbreviatePath(workingDir);
  return abbrevCwd ? `${commandName} (${abbrevCwd})` : commandName;
}
