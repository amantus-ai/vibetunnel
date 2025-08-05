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
import { createLogger, isDebugEnabled } from '../utils/logger.js';
import {
  calculateSequenceBytePosition,
  detectLastPruningSequence,
  logPruningDetection,
} from '../utils/pruning-detector.js';
import { WriteQueue } from '../utils/write-queue.js';
import { type AsciinemaEvent, type AsciinemaHeader, PtyError } from './types.js';

const _logger = createLogger('AsciinemaWriter');
const fsync = promisify(fs.fsync);

// Type for pruning sequence callback
export type PruningCallback = (info: {
  sequence: string;
  position: number;
  timestamp: number;
}) => void;

export class AsciinemaWriter {
  private writeStream: fs.WriteStream;
  private startTime: Date;
  private utf8Buffer: Buffer = Buffer.alloc(0);
  private headerWritten = false;
  private fd: number | null = null;
  private writeQueue = new WriteQueue();

  // Byte position tracking
  private bytesWritten: number = 0; // Bytes actually written to disk
  private pendingBytes: number = 0; // Bytes queued but not yet written

  // Pruning sequence detection callback
  private pruningCallback?: PruningCallback;

  // Validation tracking
  private lastValidatedPosition: number = 0;
  private validationErrors: number = 0;
  private validationInProgress: boolean = false;

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
   * Get the current byte position in the file
   * @returns Object with current position and pending bytes
   */
  getPosition(): { written: number; pending: number; total: number } {
    return {
      written: this.bytesWritten, // Bytes actually written to disk
      pending: this.pendingBytes, // Bytes in queue
      total: this.bytesWritten + this.pendingBytes, // Total position after queue flush
    };
  }

  /**
   * Set a callback to be notified when pruning sequences are detected
   * @param callback Function called with sequence info and byte position
   */
  onPruningSequence(callback: PruningCallback): void {
    this.pruningCallback = callback;
  }

  /**
   * Write the asciinema header to the file
   */
  private writeHeader(): void {
    if (this.headerWritten) return;

    this.writeQueue.enqueue(async () => {
      const headerJson = JSON.stringify(this.header);
      const headerLine = `${headerJson}\n`;
      const headerBytes = Buffer.from(headerLine, 'utf8').length;

      // Track pending bytes before write
      this.pendingBytes += headerBytes;

      const canWrite = this.writeStream.write(headerLine);
      if (!canWrite) {
        await once(this.writeStream, 'drain');
      }

      // Move bytes from pending to written
      this.bytesWritten += headerBytes;
      this.pendingBytes -= headerBytes;
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
        // First, check for pruning sequences in the data
        let pruningInfo: { sequence: string; index: number } | null = null;

        if (this.pruningCallback) {
          // Use shared detector to find pruning sequences
          const detection = detectLastPruningSequence(processedData);

          if (detection) {
            pruningInfo = detection;
            _logger.debug(
              `Found pruning sequence '${detection.sequence.split('\x1b').join('\\x1b')}' ` +
                `at string index ${detection.index} in output data`
            );
          }
        }

        // Create the event with ALL data (not truncated)
        const event: AsciinemaEvent = {
          time,
          type: 'o',
          data: processedData,
        };

        // Calculate the byte position where the event will start
        const eventStartPos = this.bytesWritten + this.pendingBytes;

        // Write the event
        await this.writeEvent(event);

        // Now that the write is complete, handle pruning callback if needed
        if (pruningInfo && this.pruningCallback) {
          // Use shared calculator for exact byte position
          const exactSequenceEndPos = calculateSequenceBytePosition(
            eventStartPos,
            time,
            processedData,
            pruningInfo.index,
            pruningInfo.sequence.length
          );

          // Validate the calculation
          const eventJson = `${JSON.stringify([time, 'o', processedData])}\n`;
          const totalEventSize = Buffer.from(eventJson, 'utf8').length;
          const calculatedEventEndPos = eventStartPos + totalEventSize;

          if (isDebugEnabled()) {
            _logger.debug(
              `Pruning sequence byte calculation:\n` +
                `  Event start position: ${eventStartPos}\n` +
                `  Event total size: ${totalEventSize} bytes\n` +
                `  Event end position: ${calculatedEventEndPos}\n` +
                `  Exact sequence position: ${exactSequenceEndPos}\n` +
                `  Current file position: ${this.bytesWritten}`
            );
          }

          // Sanity check: sequence position should be within the event
          if (exactSequenceEndPos > calculatedEventEndPos) {
            _logger.error(
              `Pruning sequence position calculation error: ` +
                `sequence position ${exactSequenceEndPos} is beyond event end ${calculatedEventEndPos}`
            );
          } else {
            // Call the callback with the exact position
            this.pruningCallback({
              sequence: pruningInfo.sequence,
              position: exactSequenceEndPos,
              timestamp: time,
            });

            // Use shared logging function
            logPruningDetection(pruningInfo.sequence, exactSequenceEndPos, '(real-time)');
          }
        }
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
      const jsonLine = `${jsonString}\n`;
      const jsonBytes = Buffer.from(jsonLine, 'utf8').length;

      // Track pending bytes before write
      this.pendingBytes += jsonBytes;

      const canWrite = this.writeStream.write(jsonLine);
      if (!canWrite) {
        await once(this.writeStream, 'drain');
      }

      // Move bytes from pending to written
      this.bytesWritten += jsonBytes;
      this.pendingBytes -= jsonBytes;
    });
  }

  /**
   * Write an asciinema event to the file
   */
  private async writeEvent(event: AsciinemaEvent): Promise<void> {
    // Asciinema format: [time, type, data]
    const eventArray = [event.time, event.type, event.data];
    const eventJson = JSON.stringify(eventArray);
    const eventLine = `${eventJson}\n`;
    const eventBytes = Buffer.from(eventLine, 'utf8').length;

    // Log detailed write information for debugging
    if (event.type === 'o' && isDebugEnabled()) {
      _logger.debug(
        `Writing output event: ${eventBytes} bytes, ` +
          `data length: ${event.data.length} chars, ` +
          `position: ${this.bytesWritten + this.pendingBytes}`
      );
    }

    // Track pending bytes before write
    this.pendingBytes += eventBytes;

    // Write and handle backpressure
    const canWrite = this.writeStream.write(eventLine);
    if (!canWrite) {
      _logger.debug('Write stream backpressure detected, waiting for drain');
      await once(this.writeStream, 'drain');
    }

    // Move bytes from pending to written
    this.bytesWritten += eventBytes;
    this.pendingBytes -= eventBytes;

    // Sync to disk asynchronously
    if (this.fd !== null) {
      try {
        await fsync(this.fd);
      } catch (err) {
        _logger.debug(`fsync failed for ${this.filePath}:`, err);
      }
    }

    // Validate position periodically (after fsync to ensure data is on disk)
    if (
      this.bytesWritten - this.lastValidatedPosition > 1024 * 1024 &&
      !this.validationInProgress
    ) {
      // Every 1MB, but only if not already validating
      // Schedule validation to run after current write completes
      // This ensures we don't block the write queue but still propagate critical errors
      this.validationInProgress = true;
      setImmediate(() => {
        this.validateFilePosition()
          .catch((err) => {
            // Log validation errors but don't crash the server
            _logger.error('Position validation failed:', err);
          })
          .finally(() => {
            this.validationInProgress = false;
          });
      });
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
   * Validate that our tracked position matches the actual file size
   */
  private async validateFilePosition(): Promise<void> {
    // Wait for write queue to complete before validating
    await this.writeQueue.drain();

    try {
      const stats = await fs.promises.stat(this.filePath);
      const actualSize = stats.size;
      const expectedSize = this.bytesWritten;

      // After draining the queue, pendingBytes should always be 0
      // Log warning if this assumption is violated to help debug tracking issues
      if (this.pendingBytes !== 0) {
        _logger.warn(
          `Unexpected state: pendingBytes should be 0 after queue drain, but found ${this.pendingBytes}`
        );
      }

      if (actualSize !== expectedSize) {
        this.validationErrors++;
        _logger.error(
          `AsciinemaWriter position mismatch! ` +
            `Expected: ${expectedSize} bytes, Actual: ${actualSize} bytes, ` +
            `Difference: ${actualSize - expectedSize} bytes, ` +
            `Validation errors: ${this.validationErrors}, ` +
            `File: ${this.filePath}`
        );

        // If the difference is significant, log as error but don't crash
        if (Math.abs(actualSize - expectedSize) > 100) {
          _logger.error(
            `Critical byte position tracking error: expected ${expectedSize}, actual ${actualSize} (file: ${this.filePath}). ` +
              `Recording may be corrupted. Attempting to recover by syncing position.`
          );

          // Attempt recovery: sync our tracked position with actual file size
          // This prevents the error from compounding
          this.bytesWritten = actualSize;
          this.lastValidatedPosition = actualSize;

          // Mark that we had a critical error for monitoring
          this.validationErrors += 10; // Weight critical errors more
        }
      } else {
        _logger.debug(`Position validation passed: ${actualSize} bytes`);
      }

      this.lastValidatedPosition = this.bytesWritten;
    } catch (error) {
      if (error instanceof PtyError) {
        throw error;
      }
      _logger.error(`Failed to validate file position for ${this.filePath}:`, error);
    }
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
