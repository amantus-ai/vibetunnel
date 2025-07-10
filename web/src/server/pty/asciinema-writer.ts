/**
 * AsciinemaWriter - Records terminal sessions in asciinema format
 *
 * This class writes terminal output in the standard asciinema cast format
 * which is compatible with asciinema players and the existing web interface.
 */

import { once } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
import { WriteQueue } from '../utils/write-queue.js';
import { StreamingAsciinemaTrancator } from './streaming-truncator.js';
import { type AsciinemaEvent, type AsciinemaHeader, PtyError } from './types.js';

const _logger = createLogger('AsciinemaWriter');
const fsync = promisify(fs.fsync);

export interface AsciinemaWriterConfig {
  maxCastSize?: number;
  castSizeCheckInterval?: number;
  castTruncationTargetPercentage?: number;
}

export class AsciinemaWriter {
  private writeStream!: fs.WriteStream; // Initialized in initializeFile()
  private startTime: Date;
  private utf8Buffer: Buffer = Buffer.alloc(0);
  private headerWritten = false;
  private fd: number | null = null;
  private writeQueue = new WriteQueue();
  private sizeCheckTimer: NodeJS.Timeout | null = null;
  private isTruncating = false;

  // Configuration with defaults from config
  private maxCastSize: number;
  private castSizeCheckInterval: number;
  private castTruncationTargetPercentage: number;

  constructor(
    private filePath: string,
    private header: AsciinemaHeader,
    writerConfig?: AsciinemaWriterConfig
  ) {
    // Set configuration with defaults
    this.maxCastSize = writerConfig?.maxCastSize ?? config.MAX_CAST_SIZE;
    this.castSizeCheckInterval =
      writerConfig?.castSizeCheckInterval ?? config.CAST_SIZE_CHECK_INTERVAL;
    this.castTruncationTargetPercentage =
      writerConfig?.castTruncationTargetPercentage ?? config.CAST_TRUNCATION_TARGET_PERCENTAGE;
    this.startTime = new Date();

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Initialize the file and write stream
    this.initializeFile();

    // Start periodic size checking
    this.startSizeChecking();
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
    env?: Record<string, string>,
    writerConfig?: AsciinemaWriterConfig
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

    return new AsciinemaWriter(filePath, header, writerConfig);
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
   * Initialize the file and write stream, handling existing large files
   */
  private initializeFile(): void {
    let fileExists = false;
    let needsTruncation = false;
    const startTime = Date.now();

    // Check if file exists and needs truncation
    try {
      const stats = fs.statSync(this.filePath);
      fileExists = true;

      if (stats.size > this.maxCastSize) {
        needsTruncation = true;
        _logger.log(
          `[TRUNCATION] Existing cast file ${this.filePath} is ${(stats.size / 1024 / 1024).toFixed(2)}MB (exceeds ${(this.maxCastSize / 1024 / 1024).toFixed(2)}MB), will truncate before opening`
        );
      }
    } catch {
      // File doesn't exist, we'll create it
      _logger.debug(`[TRUNCATION] File ${this.filePath} does not exist, will create new`);
    }

    // If file needs truncation, do it synchronously before opening the stream
    if (needsTruncation) {
      const truncateStartTime = Date.now();
      _logger.log(`[TRUNCATION] Starting synchronous truncation of ${this.filePath}`);

      try {
        this.truncateFileSync();
        const truncateDuration = Date.now() - truncateStartTime;
        _logger.log(
          `[TRUNCATION] Successfully truncated ${this.filePath} in ${truncateDuration}ms`
        );
      } catch (err) {
        const truncateDuration = Date.now() - truncateStartTime;
        _logger.error(
          `[TRUNCATION] Failed to truncate file on startup: ${this.filePath} after ${truncateDuration}ms`,
          err
        );
        // Re-throw the error - we don't want to lose data by creating a new file
        // The streaming truncation should handle any file size, so if it fails,
        // there's likely a more serious issue (permissions, disk space, etc.)
        throw err;
      }
    }

    // Decide whether to append or create new based on file existence and content
    let shouldAppend = false;
    if (fileExists) {
      const headerCheckStart = Date.now();
      try {
        // Only read first 1KB to check header - avoid reading entire file into memory
        const fd = fs.openSync(this.filePath, 'r');
        const buffer = Buffer.alloc(1024); // 1KB is enough to check header
        const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0);
        fs.closeSync(fd);

        if (bytesRead > 0) {
          const firstKB = buffer.toString('utf8', 0, bytesRead);
          const firstLine = firstKB.split('\n')[0];
          if (firstLine && firstLine.includes('"version"')) {
            // File has a valid header, append to it
            shouldAppend = true;
            this.headerWritten = true;
            _logger.debug(
              `[TRUNCATION] File has valid header, will append. Header check took ${Date.now() - headerCheckStart}ms`
            );
          }
        }
      } catch {
        // Error reading file, create new
        _logger.debug(
          `[TRUNCATION] Error reading file header, will create new. Header check took ${Date.now() - headerCheckStart}ms`
        );
      }
    }

    // Create write stream
    this.writeStream = fs.createWriteStream(this.filePath, {
      flags: shouldAppend ? 'a' : 'w',
      encoding: 'utf8',
      highWaterMark: 0, // Disable internal buffering
    });

    // Get file descriptor for fsync
    this.writeStream.on('open', (fd) => {
      this.fd = fd;
    });

    // Write header if needed
    if (!this.headerWritten) {
      this.writeHeader();
    }

    const totalDuration = Date.now() - startTime;
    _logger.log(`[TRUNCATION] initializeFile completed in ${totalDuration}ms for ${this.filePath}`);
  }

  /**
   * Synchronously truncate the file to keep only recent events
   */
  private truncateFileSync(): void {
    const truncateStart = Date.now();
    try {
      const targetSize = this.maxCastSize * this.castTruncationTargetPercentage;
      _logger.log(
        `[TRUNCATION] Calling StreamingAsciinemaTrancator.truncateFileSync with targetSize: ${(targetSize / 1024 / 1024).toFixed(2)}MB`
      );

      StreamingAsciinemaTrancator.truncateFileSync(this.filePath, {
        targetSize,
        addTruncationMarker: true,
      });

      _logger.log(
        `[TRUNCATION] Successfully truncated ${this.filePath} synchronously in ${Date.now() - truncateStart}ms`
      );
    } catch (err) {
      // If sync truncation fails (e.g., file too large), log and throw
      // This will be caught by the caller and handled appropriately
      _logger.error(
        `[TRUNCATION] Synchronous truncation failed for ${this.filePath} after ${Date.now() - truncateStart}ms:`,
        err
      );
      throw err;
    }
  }

  /**
   * Start periodic size checking
   */
  private startSizeChecking(): void {
    // Stop any existing timer
    if (this.sizeCheckTimer) {
      clearTimeout(this.sizeCheckTimer);
    }

    this.sizeCheckTimer = setTimeout(async () => {
      try {
        await this.checkAndTruncateFile();
      } catch (err) {
        _logger.error(`Error during periodic size check for ${this.filePath}:`, err);
      } finally {
        // Reschedule the next check only if the writer is still open
        if (this.isOpen()) {
          this.startSizeChecking();
        }
      }
    }, this.castSizeCheckInterval);
  }

  /**
   * Check file size and truncate if necessary
   */
  private async checkAndTruncateFile(): Promise<void> {
    // Skip if already truncating
    if (this.isTruncating) {
      return;
    }

    try {
      const stats = await fs.promises.stat(this.filePath);
      if (stats.size > this.maxCastSize) {
        _logger.log(
          `Cast file ${this.filePath} exceeds limit (${stats.size} bytes), truncating to ${this.maxCastSize} bytes`
        );
        await this.truncateFile();
      }
    } catch (err: unknown) {
      // File might not exist yet or be inaccessible
      if (err && typeof err === 'object' && 'code' in err && err.code !== 'ENOENT') {
        _logger.error(`Error checking file size for ${this.filePath}:`, err);
      }
    }
  }

  /**
   * Reopens the write stream for appending.
   */
  private reopenStream(): void {
    this.writeStream = fs.createWriteStream(this.filePath, {
      flags: 'a',
      encoding: 'utf8',
      highWaterMark: 0,
    });

    // Re-establish file descriptor
    this.writeStream.on('open', (fd) => {
      this.fd = fd;
    });
  }

  /**
   * Truncate the file to keep only recent events using streaming
   */
  private async truncateFile(): Promise<void> {
    this.isTruncating = true;

    // Wait for current writes to complete
    await this.writeQueue.drain();

    try {
      // Close current stream before truncation
      await new Promise<void>((resolve) => this.writeStream.end(resolve));

      // Use streaming truncator for memory-safe operation
      const targetSize = this.maxCastSize * this.castTruncationTargetPercentage;
      const result = await StreamingAsciinemaTrancator.truncateFile(this.filePath, {
        targetSize,
        addTruncationMarker: true,
      });

      if (result.success) {
        _logger.log(
          `Successfully truncated ${this.filePath}, removed ${result.eventsRemoved} events`
        );
      } else {
        throw result.error || new Error('Truncation failed');
      }
    } catch (err) {
      _logger.error(`Error truncating file ${this.filePath}:`, err);
    } finally {
      this.isTruncating = false;
      // Always reopen the stream for appending
      this.reopenStream();
    }
  }

  /**
   * Close the writer and finalize the file
   */
  async close(): Promise<void> {
    // Stop size checking
    if (this.sizeCheckTimer) {
      clearTimeout(this.sizeCheckTimer);
      this.sizeCheckTimer = null;
    }

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
