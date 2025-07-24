/**
 * AsciinemaWriter - Records terminal sessions in asciinema format
 *
 * This class writes terminal output in the standard asciinema cast format (v2),
 * which is compatible with asciinema players and the existing web interface.
 * It handles real-time streaming of terminal data while properly managing:
 * - UTF-8 encoding and incomplete multi-byte sequences
 * - ANSI escape sequences preservation
 * - Buffering and backpressure
 * - Atomic writes with fsync for durability
 *
 * Key features:
 * - Real-time recording with minimal buffering
 * - Proper handling of escape sequences across buffer boundaries
 * - Support for all asciinema event types (output, input, resize, markers)
 * - Automatic directory creation and file management
 * - Thread-safe write queue for concurrent operations
 *
 * @example
 * ```typescript
 * // Create a writer for a new recording
 * const writer = AsciinemaWriter.create(
 *   '/path/to/recording.cast',
 *   80,  // terminal width
 *   24,  // terminal height
 *   'npm test',  // command being recorded
 *   'Test Run Recording'  // title
 * );
 *
 * // Write terminal output
 * writer.writeOutput(Buffer.from('Hello, world!\r\n'));
 *
 * // Record user input
 * writer.writeInput('ls -la');
 *
 * // Handle terminal resize
 * writer.writeResize(120, 40);
 *
 * // Add a bookmark/marker
 * writer.writeMarker('Test started');
 *
 * // Close the recording when done
 * await writer.close();
 * ```
 */

import { once } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { createLogger } from '../utils/logger.js';
import { WriteQueue } from '../utils/write-queue.js';
import { type AsciinemaEvent, type AsciinemaHeader, PtyError } from './types.js';

const _logger = createLogger('AsciinemaWriter');
const fsync = promisify(fs.fsync);

export class AsciinemaWriter {
  private writeStream: fs.WriteStream;
  private startTime: Date;
  private utf8Buffer: Buffer = Buffer.alloc(0);
  private headerWritten = false;
  private fd: number | null = null;
  private writeQueue = new WriteQueue();

  constructor(
    private filePath: string,
    private header: AsciinemaHeader
  ) {
    this.startTime = new Date();

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Create write stream with no buffering for real-time performance
    this.writeStream = fs.createWriteStream(filePath, {
      flags: 'w',
      encoding: 'utf8',
      highWaterMark: 0, // Disable internal buffering
    });

    // Get file descriptor for fsync
    this.writeStream.on('open', (fd) => {
      this.fd = fd;
    });

    this.writeHeader();
  }

  /**
   * Create an AsciinemaWriter with standard parameters
   */
  static create(
    filePath: string,
    width: number = 80,
    height: number = 24,
    command?: string,
    title?: string,
    env?: Record<string, string>
  ): AsciinemaWriter {
    const header: AsciinemaHeader = {
      version: 2,
      width,
      height,
      timestamp: Math.floor(Date.now() / 1000),
      command,
      title,
      env,
    };

    return new AsciinemaWriter(filePath, header);
  }

  /**
   * Write the asciinema header to the file
   */
  private writeHeader(): void {
    if (this.headerWritten) return;

    this.writeQueue.enqueue(async () => {
      const headerJson = JSON.stringify(this.header);
      const canWrite = this.writeStream.write(`${headerJson}\n`);
      if (!canWrite) {
        await once(this.writeStream, 'drain');
      }
    });
    this.headerWritten = true;
  }

  /**
   * Write terminal output data
   */
  writeOutput(data: Buffer): void {
    this.writeQueue.enqueue(async () => {
      const time = this.getElapsedTime();

      // Combine any buffered bytes with the new data
      const combinedBuffer = Buffer.concat([this.utf8Buffer, data]);

      // Process data in escape-sequence-aware chunks
      const { processedData, remainingBuffer } = this.processTerminalData(combinedBuffer);

      if (processedData.length > 0) {
        const event: AsciinemaEvent = {
          time,
          type: 'o',
          data: processedData,
        };
        await this.writeEvent(event);
      }

      // Store any remaining incomplete data for next time
      this.utf8Buffer = remainingBuffer;
    });
  }

  /**
   * Write terminal input data (usually from user)
   */
  writeInput(data: string): void {
    this.writeQueue.enqueue(async () => {
      const time = this.getElapsedTime();
      const event: AsciinemaEvent = {
        time,
        type: 'i',
        data,
      };
      await this.writeEvent(event);
    });
  }

  /**
   * Write terminal resize event
   */
  writeResize(cols: number, rows: number): void {
    this.writeQueue.enqueue(async () => {
      const time = this.getElapsedTime();
      const event: AsciinemaEvent = {
        time,
        type: 'r',
        data: `${cols}x${rows}`,
      };
      await this.writeEvent(event);
    });
  }

  /**
   * Write marker event (for bookmarks/annotations)
   */
  writeMarker(message: string): void {
    this.writeQueue.enqueue(async () => {
      const time = this.getElapsedTime();
      const event: AsciinemaEvent = {
        time,
        type: 'm',
        data: message,
      };
      await this.writeEvent(event);
    });
  }

  /**
   * Write a raw JSON event (for custom events like exit)
   */
  writeRawJson(jsonValue: unknown): void {
    this.writeQueue.enqueue(async () => {
      const jsonString = JSON.stringify(jsonValue);
      const canWrite = this.writeStream.write(`${jsonString}\n`);
      if (!canWrite) {
        await once(this.writeStream, 'drain');
      }
    });
  }

  /**
   * Write an asciinema event to the file
   */
  private async writeEvent(event: AsciinemaEvent): Promise<void> {
    // Asciinema format: [time, type, data]
    const eventArray = [event.time, event.type, event.data];
    const eventJson = JSON.stringify(eventArray);

    // Write and handle backpressure
    const canWrite = this.writeStream.write(`${eventJson}\n`);
    if (!canWrite) {
      await once(this.writeStream, 'drain');
    }

    // Sync to disk asynchronously
    if (this.fd !== null) {
      try {
        await fsync(this.fd);
      } catch (err) {
        _logger.debug(`fsync failed for ${this.filePath}:`, err);
      }
    }
  }

  /**
   * Process terminal data while preserving escape sequences and handling UTF-8
   */
  private processTerminalData(buffer: Buffer): { processedData: string; remainingBuffer: Buffer } {
    let result = '';
    let pos = 0;

    while (pos < buffer.length) {
      // Look for escape sequences starting with ESC (0x1B)
      if (buffer[pos] === 0x1b) {
        // Try to find complete escape sequence
        const seqEnd = this.findEscapeSequenceEnd(buffer.subarray(pos));
        if (seqEnd !== null) {
          const seqBytes = buffer.subarray(pos, pos + seqEnd);
          // Preserve escape sequence as-is using toString to maintain exact bytes
          result += seqBytes.toString('latin1');
          pos += seqEnd;
        } else {
          // Incomplete escape sequence at end of buffer - save for later
          return {
            processedData: result,
            remainingBuffer: buffer.subarray(pos),
          };
        }
      } else {
        // Regular text - find the next escape sequence or end of valid UTF-8
        const chunkStart = pos;
        while (pos < buffer.length && buffer[pos] !== 0x1b) {
          pos++;
        }

        const textChunk = buffer.subarray(chunkStart, pos);

        // Handle UTF-8 validation for text chunks
        try {
          const validText = textChunk.toString('utf8');
          result += validText;
        } catch (_e) {
          // Try to find how much is valid UTF-8
          const { validData, invalidStart } = this.findValidUtf8(textChunk);

          if (validData.length > 0) {
            result += validData.toString('utf8');
          }

          // Check if we have incomplete UTF-8 at the end
          if (invalidStart < textChunk.length && pos >= buffer.length) {
            const remaining = buffer.subarray(chunkStart + invalidStart);

            // If it might be incomplete UTF-8 at buffer end, save it
            if (remaining.length <= 4 && this.mightBeIncompleteUtf8(remaining)) {
              return {
                processedData: result,
                remainingBuffer: remaining,
              };
            }
          }

          // Invalid UTF-8 in middle or complete invalid sequence
          // Use lossy conversion for this part
          const invalidPart = textChunk.subarray(invalidStart);
          result += invalidPart.toString('latin1');
        }
      }
    }

    return { processedData: result, remainingBuffer: Buffer.alloc(0) };
  }

  /**
   * Find the end of an ANSI escape sequence
   */
  private findEscapeSequenceEnd(buffer: Buffer): number | null {
    if (buffer.length === 0 || buffer[0] !== 0x1b) {
      return null;
    }

    if (buffer.length < 2) {
      return null; // Incomplete - need more data
    }

    switch (buffer[1]) {
      // CSI sequences: ESC [ ... final_char
      case 0x5b: {
        // '['
        let pos = 2;
        // Skip parameter and intermediate characters
        while (pos < buffer.length) {
          const byte = buffer[pos];
          if (byte >= 0x20 && byte <= 0x3f) {
            // Parameter characters 0-9 : ; < = > ? and Intermediate characters
            pos++;
          } else if (byte >= 0x40 && byte <= 0x7e) {
            // Final character @ A-Z [ \ ] ^ _ ` a-z { | } ~
            return pos + 1;
          } else {
            // Invalid sequence, stop here
            return pos;
          }
        }
        return null; // Incomplete sequence
      }

      // OSC sequences: ESC ] ... (ST or BEL)
      case 0x5d: {
        // ']'
        let pos = 2;
        while (pos < buffer.length) {
          const byte = buffer[pos];
          if (byte === 0x07) {
            // BEL terminator
            return pos + 1;
          } else if (byte === 0x1b && pos + 1 < buffer.length && buffer[pos + 1] === 0x5c) {
            // ESC \ (ST) terminator
            return pos + 2;
          }
          pos++;
        }
        return null; // Incomplete sequence
      }

      // Simple two-character sequences: ESC letter
      default:
        return 2;
    }
  }

  /**
   * Find valid UTF-8 portion of a buffer
   */
  private findValidUtf8(buffer: Buffer): { validData: Buffer; invalidStart: number } {
    for (let i = 0; i < buffer.length; i++) {
      try {
        const testSlice = buffer.subarray(0, i + 1);
        testSlice.toString('utf8');
      } catch (_e) {
        // Found invalid UTF-8, return valid portion
        return {
          validData: buffer.subarray(0, i),
          invalidStart: i,
        };
      }
    }

    // All valid
    return {
      validData: buffer,
      invalidStart: buffer.length,
    };
  }

  /**
   * Check if a buffer might contain incomplete UTF-8 sequence
   */
  private mightBeIncompleteUtf8(buffer: Buffer): boolean {
    if (buffer.length === 0) return false;

    // Check if first byte indicates multi-byte UTF-8 character
    const firstByte = buffer[0];

    // Single byte (ASCII) - not incomplete
    if (firstByte < 0x80) return false;

    // Multi-byte sequence starters
    if (firstByte >= 0xc0) {
      // 2-byte sequence needs 2 bytes
      if (firstByte < 0xe0) return buffer.length < 2;
      // 3-byte sequence needs 3 bytes
      if (firstByte < 0xf0) return buffer.length < 3;
      // 4-byte sequence needs 4 bytes
      if (firstByte < 0xf8) return buffer.length < 4;
    }

    return false;
  }

  /**
   * Get elapsed time since start in seconds
   */
  private getElapsedTime(): number {
    return (Date.now() - this.startTime.getTime()) / 1000;
  }

  /**
   * Close the writer and finalize the file
   */
  async close(): Promise<void> {
    // Flush any remaining UTF-8 buffer through the queue
    if (this.utf8Buffer.length > 0) {
      // Force write any remaining data using lossy conversion
      const time = this.getElapsedTime();
      const event: AsciinemaEvent = {
        time,
        type: 'o',
        data: this.utf8Buffer.toString('latin1'),
      };
      // Use the queue to ensure ordering
      this.writeQueue.enqueue(async () => {
        await this.writeEvent(event);
      });
      this.utf8Buffer = Buffer.alloc(0);
    }

    // Wait for all queued writes to complete
    await this.writeQueue.drain();

    // Now it's safe to end the stream
    return new Promise((resolve, reject) => {
      this.writeStream.end((error?: Error) => {
        if (error) {
          reject(new PtyError(`Failed to close asciinema writer: ${error.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Check if the writer is still open
   */
  isOpen(): boolean {
    return !this.writeStream.destroyed;
  }
}
