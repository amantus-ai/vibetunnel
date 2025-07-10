/**
 * StreamingAsciinemaTrancator - Handles truncation of large asciicast files without loading them into memory
 *
 * This class provides memory-safe truncation of asciicast files by:
 * 1. Streaming through the file line-by-line
 * 2. Maintaining a sliding window of recent events that fit within the target size
 * 3. Writing results to a temporary file and atomically replacing the original
 *
 * Memory usage is bounded to approximately the target file size (default 1MB) plus small buffers.
 */

import * as fs from 'fs';
import { createReadStream, createWriteStream, promises as fsPromises } from 'fs';
import { createInterface } from 'readline';
import { createLogger } from '../utils/logger.js';
import type { AsciinemaHeader } from './types.js';

const logger = createLogger('streaming-truncator');

interface TruncationOptions {
  targetSize: number;
  addTruncationMarker?: boolean;
}

interface EventEntry {
  line: string;
  size: number;
}

export class StreamingAsciinemaTrancator {
  /**
   * Truncate an asciicast file to the target size using streaming
   *
   * @param filePath - Path to the asciicast file to truncate
   * @param options - Truncation options
   * @returns Object with truncation results
   */
  static async truncateFile(
    filePath: string,
    options: TruncationOptions
  ): Promise<{
    success: boolean;
    originalSize: number;
    truncatedSize: number;
    eventsRemoved: number;
    error?: Error;
  }> {
    const startTime = Date.now();
    const tempFile = `${filePath}.tmp.${process.pid}`;

    try {
      // Get original file size
      const stats = await fsPromises.stat(filePath);
      const originalSize = stats.size;

      // If file is already under target size, nothing to do
      if (originalSize <= options.targetSize) {
        return {
          success: true,
          originalSize,
          truncatedSize: originalSize,
          eventsRemoved: 0,
        };
      }

      logger.log(
        `Starting streaming truncation of ${filePath} (${(originalSize / 1024 / 1024).toFixed(2)}MB)`
      );

      // Perform the truncation
      const result = await StreamingAsciinemaTrancator.performTruncation(
        filePath,
        tempFile,
        options
      );

      // Atomic replace
      await fsPromises.rename(tempFile, filePath);

      // Get final size
      const newStats = await fsPromises.stat(filePath);
      const truncatedSize = newStats.size;

      const duration = Date.now() - startTime;
      logger.log(
        `Successfully truncated ${filePath}: ${(originalSize / 1024 / 1024).toFixed(2)}MB → ` +
          `${(truncatedSize / 1024 / 1024).toFixed(2)}MB (removed ${result.eventsRemoved} events in ${duration}ms)`
      );

      return {
        success: true,
        originalSize,
        truncatedSize,
        eventsRemoved: result.eventsRemoved,
      };
    } catch (error) {
      // Clean up temp file on error
      try {
        await fsPromises.unlink(tempFile);
      } catch {
        // Ignore cleanup errors
      }

      logger.error(`Failed to truncate ${filePath}:`, error);

      return {
        success: false,
        originalSize: 0,
        truncatedSize: 0,
        eventsRemoved: 0,
        error: error as Error,
      };
    }
  }

  /**
   * Perform the actual truncation using streaming
   */
  private static async performTruncation(
    inputPath: string,
    outputPath: string,
    options: TruncationOptions
  ): Promise<{ eventsRemoved: number; totalEvents: number }> {
    return new Promise((resolve, reject) => {
      const readStream = createReadStream(inputPath, {
        encoding: 'utf8',
        highWaterMark: 16 * 1024, // 16KB chunks for efficient I/O
      });

      const writeStream = createWriteStream(outputPath, {
        encoding: 'utf8',
      });

      const rl = createInterface({
        input: readStream,
        crlfDelay: Number.POSITIVE_INFINITY, // Handle both \r\n and \n
      });

      let header: string | null = null;
      const eventBuffer: EventEntry[] = [];
      let bufferSize = 0;
      let totalEvents = 0;
      let linesProcessed = 0;

      // Reserve space for header and potential truncation marker
      const reservedSize = 512; // Typical header is ~200-300 bytes
      const effectiveTargetSize = options.targetSize - reservedSize;

      rl.on('line', (line: string) => {
        linesProcessed++;

        // Skip empty lines
        if (!line.trim()) {
          return;
        }

        // First line is the header
        if (!header) {
          header = line;
          return;
        }

        // This is an event line
        totalEvents++;
        const lineSize = Buffer.byteLength(`${line}\n`, 'utf8');

        // Add to buffer
        eventBuffer.push({ line, size: lineSize });
        bufferSize += lineSize;

        // Remove oldest events if buffer exceeds target size
        while (bufferSize > effectiveTargetSize && eventBuffer.length > 1) {
          const removed = eventBuffer.shift()!;
          bufferSize -= removed.size;
        }

        // Log progress every 100k lines
        if (linesProcessed % 100000 === 0) {
          logger.debug(
            `Processed ${linesProcessed} lines, ${totalEvents} events, ` +
              `buffer: ${eventBuffer.length} events (${(bufferSize / 1024).toFixed(2)}KB)`
          );
        }
      });

      rl.on('close', async () => {
        try {
          // Write header
          if (header) {
            await StreamingAsciinemaTrancator.writeLineAsync(writeStream, header);
          }

          const eventsRemoved = totalEvents - eventBuffer.length;

          // Add truncation marker if requested and events were removed
          if (options.addTruncationMarker && eventsRemoved > 0) {
            const truncationEvent = StreamingAsciinemaTrancator.createTruncationMarker(
              eventsRemoved,
              header
            );
            if (truncationEvent) {
              await StreamingAsciinemaTrancator.writeLineAsync(writeStream, truncationEvent);
            }
          }

          // Write all buffered events
          for (const event of eventBuffer) {
            await StreamingAsciinemaTrancator.writeLineAsync(writeStream, event.line);
          }

          // Close write stream
          await new Promise<void>((res, rej) => {
            writeStream.end((err?: Error) => {
              if (err) rej(err);
              else res();
            });
          });

          resolve({ eventsRemoved, totalEvents });
        } catch (error) {
          reject(error);
        }
      });

      rl.on('error', (error: Error) => {
        logger.error('Error reading file:', error);
        reject(error);
      });

      writeStream.on('error', (error: Error) => {
        logger.error('Error writing file:', error);
        reject(error);
      });
    });
  }

  /**
   * Write a line to the stream with proper error handling
   */
  private static async writeLineAsync(stream: NodeJS.WritableStream, line: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const canWrite = stream.write(`${line}\n`, (error) => {
        if (error) {
          reject(error);
        } else if (!canWrite) {
          // Wait for drain event if buffer is full
          stream.once('drain', resolve);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Create a truncation marker event
   */
  private static createTruncationMarker(
    eventsRemoved: number,
    header: string | null
  ): string | null {
    if (!header) return null;

    try {
      // Parse header to get timestamp
      const headerData = JSON.parse(header) as AsciinemaHeader;
      const currentTime = Math.floor(Date.now() / 1000);
      const elapsedTime = currentTime - (headerData.timestamp || currentTime);

      // Create a marker event
      const markerEvent = JSON.stringify([
        Math.max(0, elapsedTime),
        'o',
        `\n[Truncated ${eventsRemoved} events to limit file size]\n`,
      ]);

      return markerEvent;
    } catch (error) {
      logger.warn('Failed to create truncation marker:', error);
      return null;
    }
  }

  /**
   * Estimate the number of events that will fit in the target size
   * This is used for logging and progress reporting
   */
  static estimateEventCapacity(targetSize: number, averageEventSize: number = 100): number {
    // Reserve space for header and safety margin
    const effectiveSize = targetSize - 1024;
    return Math.floor(effectiveSize / averageEventSize);
  }

  /**
   * Synchronous truncation for initialization (small files only)
   * Falls back to async for large files
   */
  static truncateFileSync(filePath: string, options: TruncationOptions): void {
    const startTime = Date.now();

    try {
      // Get file size first
      const stats = fs.statSync(filePath);
      const fileSize = stats.size;

      // If file is already under target size, nothing to do
      if (fileSize <= options.targetSize) {
        return;
      }

      // For files over 50MB, throw error to force async handling
      const MAX_SYNC_SIZE = 50 * 1024 * 1024; // 50MB
      if (fileSize > MAX_SYNC_SIZE) {
        throw new Error(
          `File too large for synchronous truncation (${(fileSize / 1024 / 1024).toFixed(2)}MB). ` +
            `Maximum sync size is ${MAX_SYNC_SIZE / 1024 / 1024}MB.`
        );
      }

      logger.log(
        `Performing synchronous truncation of ${filePath} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`
      );

      // Read file content
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.trim().split('\n');

      if (lines.length < 2) {
        return; // Nothing to truncate
      }

      // First line is the header
      const header = lines[0];
      const events = lines.slice(1);

      // Calculate how many events to keep
      const reservedSize = 512;
      const effectiveTargetSize = options.targetSize - reservedSize;
      const headerSize = Buffer.byteLength(`${header}\n`, 'utf8');
      const availableSize = effectiveTargetSize - headerSize;

      // Keep events from the end that fit within the size limit
      const keptEvents: string[] = [];
      let currentSize = 0;

      for (let i = events.length - 1; i >= 0; i--) {
        const eventSize = Buffer.byteLength(`${events[i]}\n`, 'utf8');
        if (currentSize + eventSize > availableSize) {
          break;
        }
        keptEvents.unshift(events[i]);
        currentSize += eventSize;
      }

      const eventsRemoved = events.length - keptEvents.length;

      // Add truncation marker if requested and events were removed
      if (options.addTruncationMarker && eventsRemoved > 0) {
        const truncationEvent = StreamingAsciinemaTrancator.createTruncationMarker(
          eventsRemoved,
          header
        );
        if (truncationEvent) {
          const markerSize = Buffer.byteLength(`${truncationEvent}\n`, 'utf8');
          // Make room for marker if needed
          if (currentSize + markerSize > availableSize && keptEvents.length > 0) {
            keptEvents.shift();
          }
          keptEvents.unshift(truncationEvent);
        }
      }

      // Write to temp file and rename atomically
      const tempFile = `${filePath}.tmp.${process.pid}`;
      const newContent = `${header}\n${keptEvents.join('\n')}\n`;

      fs.writeFileSync(tempFile, newContent, 'utf8');
      fs.renameSync(tempFile, filePath);

      const duration = Date.now() - startTime;
      logger.log(
        `Successfully truncated ${filePath} synchronously: removed ${eventsRemoved} events in ${duration}ms`
      );
    } catch (error) {
      logger.error(`Failed to truncate ${filePath} synchronously:`, error);
      throw error;
    }
  }
}
