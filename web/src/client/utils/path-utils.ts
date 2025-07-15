/**
 * Path utilities for formatting and clipboard operations
 */

/**
 * Format a file path for display by replacing the home directory with ~
 *
 * Handles common home directory patterns across different platforms:
 * - macOS: /Users/username
 * - Linux: /home/username
 * - Windows: C:\Users\username or C:/Users/username (case-insensitive)
 * - Root: /root
 *
 * @param path - The absolute path to format
 * @returns The formatted path with ~ replacing the home directory
 *
 * @example
 * formatPathForDisplay('/Users/john/Documents') // returns '~/Documents'
 * formatPathForDisplay('C:\\Users\\jane\\Desktop') // returns '~/Desktop'
 * formatPathForDisplay('/home/bob/projects') // returns '~/projects'
 */
// Compile regex once for better performance
const HOME_PATTERN = /^(?:\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:[/\\]Users[/\\][^/\\]+|\/root)/;

export function formatPathForDisplay(path: string): string {
  if (!path) return '';

  // If the path is already using ~ notation, return as-is
  if (path.startsWith('~')) {
    return path;
  }

  // Apply home directory replacement for absolute paths
  // This includes Unix paths (starting with /) and Windows paths (starting with drive letter)
  // Use pre-compiled regex for better performance
  // The regex safely matches home directories without being affected by special characters in usernames
  return path.replace(HOME_PATTERN, '~');
}

/**
 * Copy text to clipboard with fallback for older browsers
 *
 * Attempts to use the modern Clipboard API first, then falls back to the
 * deprecated execCommand method for older browsers.
 *
 * @param text - The text to copy to clipboard
 * @returns A promise that resolves to true if successful, false otherwise
 *
 * @example
 * const success = await copyToClipboard('Hello, world!');
 * if (success) {
 *   console.log('Text copied to clipboard');
 * }
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_error) {
    // Fallback for older browsers or permission issues
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      const result = document.execCommand('copy');
      document.body.removeChild(textArea);
      return result;
    } catch (_err) {
      document.body.removeChild(textArea);
      return false;
    }
  }
}
