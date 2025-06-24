/**
 * Path utilities for formatting and displaying paths
 */

/**
 * Format a file path for display by replacing the home directory with ~
 * @param path The absolute path to format
 * @returns The formatted path with ~ replacing the home directory
 */
export function formatPathForDisplay(path: string): string {
  const homeDir = '/Users/steipete';
  if (path.startsWith(homeDir)) {
    return `~${path.slice(homeDir.length)}`;
  }
  return path;
}

/**
 * Copy text to clipboard with fallback for older browsers
 * @param text The text to copy
 * @returns Promise<boolean> indicating success
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
