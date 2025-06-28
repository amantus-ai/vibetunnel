/**
 * ANSI escape sequence filtering utilities
 *
 * Filters out terminal title escape sequences (OSC 0, 1, 2) while preserving
 * all other terminal output intact.
 */

// Pre-compiled regex for performance
// Matches: ESC ] (0|1|2) ; <any text> (BEL | ESC \)
// Using non-greedy matching to handle multiple sequences in one buffer
// biome-ignore lint/suspicious/noControlCharactersInRegex: Control characters are required to match terminal escape sequences
const TITLE_SEQUENCE_REGEX = /\x1B\](?:0|1|2);[^\x07\x1B]*(?:\x07|\x1B\\)/g;

/**
 * Filter out terminal title escape sequences from data.
 *
 * Terminal title sequences:
 * - OSC 0: Set icon and window title: ESC ] 0 ; <title> BEL
 * - OSC 1: Set icon title: ESC ] 1 ; <title> BEL
 * - OSC 2: Set window title: ESC ] 2 ; <title> BEL
 *
 * These can end with either BEL (\x07) or ESC \ (\x1B\x5C)
 *
 * @param data The terminal output data to filter
 * @param filterTitles Whether to filter title sequences (if false, returns data unchanged)
 * @returns The filtered data
 */
export function filterTerminalTitleSequences(data: string, filterTitles: boolean): string {
  if (!filterTitles) {
    return data;
  }

  return data.replace(TITLE_SEQUENCE_REGEX, '');
}

/**
 * Filter terminal title sequences from a Buffer.
 * Converts to string, filters, and converts back to Buffer.
 *
 * @param buffer The terminal output buffer to filter
 * @param filterTitles Whether to filter title sequences
 * @returns The filtered buffer
 */
export function filterTerminalTitleSequencesBuffer(buffer: Buffer, filterTitles: boolean): Buffer {
  if (!filterTitles) {
    return buffer;
  }

  // Convert to string for filtering
  const str = buffer.toString('utf8');
  const filtered = filterTerminalTitleSequences(str, filterTitles);

  // Only create new buffer if something was filtered
  if (filtered === str) {
    return buffer;
  }

  return Buffer.from(filtered, 'utf8');
}
