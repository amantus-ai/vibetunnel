/**
 * ANSI escape sequence filter that handles sequences split across buffer boundaries
 *
 * This implementation uses a state machine to properly handle ANSI escape sequences
 * that may be split across multiple data chunks, which is common when processing
 * streaming terminal output.
 */

/**
 * State machine for parsing ANSI escape sequences
 */
enum ParseState {
  NORMAL,
  ESC_START, // Seen ESC (\x1B)
  OSC_START, // Seen ESC ]
  OSC_DIGITS, // Parsing OSC command digits
  OSC_CONTENT, // Inside OSC content
}

/**
 * Filter for terminal title sequences that properly handles
 * escape sequences split across buffer boundaries.
 */
export class AnsiFilter {
  private buffer = '';
  private state = ParseState.NORMAL;
  private pendingSequence = '';

  /**
   * Reset the filter state
   */
  reset(): void {
    this.buffer = '';
    this.state = ParseState.NORMAL;
    this.pendingSequence = '';
  }

  /**
   * Filter terminal title sequences from the input data.
   * Handles escape sequences that may be split across multiple chunks.
   *
   * @param data The input data to filter
   * @param filterTitles Whether to filter title sequences
   * @returns The filtered data
   */
  filter(data: string, filterTitles: boolean): string {
    if (!filterTitles) {
      return data;
    }

    // Prepend any pending incomplete sequence from previous call
    const fullData = this.pendingSequence + data;
    this.pendingSequence = '';

    let output = '';
    let i = 0;

    while (i < fullData.length) {
      const char = fullData[i];

      switch (this.state) {
        case ParseState.NORMAL:
          if (char === '\x1B') {
            // Start of escape sequence
            this.buffer = char;
            this.state = ParseState.ESC_START;
          } else {
            output += char;
          }
          break;

        case ParseState.ESC_START:
          this.buffer += char;
          if (char === ']') {
            // OSC sequence start
            this.state = ParseState.OSC_DIGITS;
          } else {
            // Not an OSC sequence, output the buffer
            output += this.buffer;
            this.buffer = '';
            this.state = ParseState.NORMAL;
            continue; // Re-process this character
          }
          break;

        case ParseState.OSC_DIGITS:
          this.buffer += char;
          if (char >= '0' && char <= '9') {
            // Still parsing digits
          } else if (char === ';') {
            // Check if it's a title sequence (OSC 0, 1, or 2)
            const oscNumber = Number.parseInt(this.buffer.slice(2, -1), 10);
            if (oscNumber >= 0 && oscNumber <= 2) {
              // This is a title sequence, continue parsing
              this.state = ParseState.OSC_CONTENT;
            } else {
              // Not a title sequence, output it
              output += this.buffer;
              this.buffer = '';
              this.state = ParseState.NORMAL;
            }
          } else {
            // Invalid OSC sequence
            output += this.buffer;
            this.buffer = '';
            this.state = ParseState.NORMAL;
            continue; // Re-process this character
          }
          break;

        case ParseState.OSC_CONTENT:
          this.buffer += char;
          if (char === '\x07') {
            // BEL terminator - sequence complete
            // Filter out the title sequence (don't add to output)
            this.buffer = '';
            this.state = ParseState.NORMAL;
          } else if (char === '\x1B') {
            // Possible ST terminator start
            // Check if we can look ahead
            if (i + 1 < fullData.length && fullData[i + 1] === '\\') {
              // Complete ST terminator
              this.buffer += '\\';
              i++; // Skip the backslash
              // Filter out the title sequence (don't add to output)
              this.buffer = '';
              this.state = ParseState.NORMAL;
            } else if (i + 1 >= fullData.length) {
              // At end of buffer, can't determine if this is ST
              // Save as pending and break
              this.pendingSequence = this.buffer;
              this.buffer = '';
              this.state = ParseState.NORMAL; // Reset for next call
              i++; // Move past this character
              break; // Exit the while loop
            }
          }
          break;
      }

      i++;
    }

    // If we're still in the middle of parsing a sequence at the end,
    // save it as pending for the next call
    if (this.state !== ParseState.NORMAL && this.buffer) {
      this.pendingSequence = this.buffer;
      this.buffer = '';
      // Keep the state for next call
    }

    return output;
  }

  /**
   * Filter terminal title sequences from a Buffer.
   * Converts to string, filters, and converts back to Buffer.
   *
   * @param buffer The terminal output buffer to filter
   * @param filterTitles Whether to filter title sequences
   * @returns The filtered buffer
   */
  filterBuffer(buffer: Buffer, filterTitles: boolean): Buffer {
    if (!filterTitles) {
      return buffer;
    }

    const str = buffer.toString('utf8');
    const filtered = this.filter(str, filterTitles);

    // Only create new buffer if something was filtered
    if (filtered === str) {
      return buffer;
    }

    return Buffer.from(filtered, 'utf8');
  }
}
