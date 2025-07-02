/**
 * Simple and robust filter for ANSI title sequences (OSC 0, 1, and 2)
 *
 * This filter removes terminal title sequences from the output stream without
 * attempting to parse other ANSI sequences, avoiding the complexity and bugs
 * of a full ANSI parser.
 */

export class TitleSequenceFilter {
  private buffer = '';

  // Compile regexes once as static properties for better performance
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences require control characters
  private static readonly COMPLETE_TITLE_REGEX = /\x1b\][0-2];[^\x07\x1b]*(?:\x07|\x1b\\)/g;
  private static readonly PARTIAL_TITLE_REGEX =
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences require control characters
    /\x1b\][0-2];.*\x1b$|\x1b\][0-2];[^\x07]*$|\x1b(?:\](?:[0-2])?)?$/;

  /**
   * Filter terminal title sequences from the input data.
   * Handles sequences that may be split across multiple chunks.
   *
   * @param chunk The input data chunk to filter
   * @returns The filtered data with title sequences removed
   */
  filter(chunk: string): string {
    // Append new chunk to any leftover buffer
    this.buffer += chunk;

    // Remove all complete title sequences
    // Matches: ESC ] 0/1/2 ; <title text> BEL or ESC ] 0/1/2 ; <title text> ESC \
    const filtered = this.buffer.replace(TitleSequenceFilter.COMPLETE_TITLE_REGEX, '');

    // Check if we have a partial title sequence at the end
    // This includes sequences that might be terminated by ESC \ where the ESC is at the end
    // We need to look for:
    // - \x1b at the end (could be start of new sequence OR part of \x1b\\ terminator)
    // - \x1b] at the end
    // - \x1b][0-2] at the end
    // - \x1b][0-2]; followed by any text ending with \x1b (potential \x1b\\ terminator)
    // - \x1b][0-2]; followed by any text without terminator
    const partialMatch = filtered.match(TitleSequenceFilter.PARTIAL_TITLE_REGEX);

    if (partialMatch) {
      // Save the partial sequence for the next chunk
      this.buffer = partialMatch[0];
      // Return everything except the partial sequence
      return filtered.slice(0, -partialMatch[0].length);
    }

    // No partial sequence, clear buffer and return everything
    this.buffer = '';
    return filtered;
  }
}
