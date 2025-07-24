// Utility functions to convert asciinema cast files to data for DOM terminal
// Converts cast format to string data that can be written via terminal.write()

import { createLogger } from './logger.js';

const logger = createLogger('cast-converter');

interface CastHeader {
  version: number;
  width: number;
  height: number;
  timestamp?: number;
  env?: Record<string, string>;
}

interface CastEvent {
  timestamp: number;
  type: 'o' | 'i' | 'r'; // output, input, or resize
  data: string;
}

export interface ConvertedCast {
  header: CastHeader | null;
  content: string; // All output data concatenated
  events: CastEvent[]; // Original events for advanced usage
  totalDuration: number; // Duration in seconds
}

/**
 * Convert cast file content to data for DOM terminal
 * @param castContent - Raw cast file content (asciinema format)
 * @returns Converted cast data
 */
export function convertCast(castContent: string): ConvertedCast {
  const lines = castContent.trim().split('\n');
  let header: CastHeader | null = null;
  const events: CastEvent[] = [];
  const outputChunks: string[] = [];
  let totalDuration = 0;

  // Parse each line of the cast file
  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const parsed = JSON.parse(line);

      // Check if this is a header line
      if (parsed.version && parsed.width && parsed.height) {
        header = parsed as CastHeader;
        continue;
      }

      // Check if this is an event line [timestamp, type, data]
      if (Array.isArray(parsed) && parsed.length >= 3) {
        const event: CastEvent = {
          timestamp: parsed[0],
          type: parsed[1],
          data: parsed[2],
        };

        events.push(event);

        // Track total duration
        if (event.timestamp > totalDuration) {
          totalDuration = event.timestamp;
        }

        // Collect output events for concatenated content
        if (event.type === 'o') {
          outputChunks.push(event.data);
        }
      }
    } catch (_error) {
      logger.warn('failed to parse cast line');
    }
  }

  return {
    header,
    content: outputChunks.join(''),
    events,
    totalDuration,
  };
}

/**
 * Load and convert cast file from URL
 * @param url - URL to the cast file
 * @returns Promise with converted cast data
 */
export async function loadAndConvert(url: string): Promise<ConvertedCast> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load cast file: ${response.status} ${response.statusText}`);
  }
  const content = await response.text();
  return convertCast(content);
}

/**
 * Convert cast to output-only content (filters out input/resize events)
 * @param castContent - Raw cast file content
 * @returns Just the output content as a string
 */
export function convertToOutputOnly(castContent: string): string {
  const converted = convertCast(castContent);
  return converted.content;
}

/**
 * Get terminal dimensions from cast header
 * @param castContent - Raw cast file content
 * @returns Terminal dimensions or defaults
 */
export function getTerminalDimensions(castContent: string): { cols: number; rows: number } {
  const converted = convertCast(castContent);
  return {
    cols: converted.header?.width || 80,
    rows: converted.header?.height || 24,
  };
}

/**
 * Convert cast events to timed playback data
 * @param castContent - Raw cast file content
 * @returns Array of timed events for animation playback
 */
export function convertToTimedEvents(castContent: string): Array<{
  delay: number; // Milliseconds to wait before this event
  type: 'output' | 'resize';
  data: string;
  cols?: number;
  rows?: number;
}> {
  const converted = convertCast(castContent);
  const timedEvents: Array<{
    delay: number;
    type: 'output' | 'resize';
    data: string;
    cols?: number;
    rows?: number;
  }> = [];

  let lastTimestamp = 0;

  for (const event of converted.events) {
    const delay = Math.max(0, (event.timestamp - lastTimestamp) * 1000); // Convert to milliseconds

    if (event.type === 'o') {
      timedEvents.push({
        delay,
        type: 'output',
        data: event.data,
      });
    } else if (event.type === 'r') {
      // Parse resize data "WIDTHxHEIGHT"
      const match = event.data.match(/^(\d+)x(\d+)$/);
      if (match) {
        timedEvents.push({
          delay,
          type: 'resize',
          data: event.data,
          cols: Number.parseInt(match[1], 10),
          rows: Number.parseInt(match[2], 10),
        });
      }
    }

    lastTimestamp = event.timestamp;
  }

  return timedEvents;
}

/**
 * Helper to play cast content with timing on a DOM terminal
 * @param terminal - DOM terminal instance with write() method
 * @param castContent - Raw cast file content
 * @param speedMultiplier - Playback speed (1.0 = normal, 2.0 = 2x speed, etc.)
 * @returns Promise that resolves when playback is complete
 */
export async function playOnTerminal(
  terminal: {
    write: (data: string) => void;
    setTerminalSize?: (cols: number, rows: number) => void;
  },
  castContent: string,
  speedMultiplier: number = 1.0
): Promise<void> {
  const timedEvents = convertToTimedEvents(castContent);
  const converted = convertCast(castContent);

  // Set initial terminal size if possible
  if (terminal.setTerminalSize && converted.header) {
    terminal.setTerminalSize(converted.header.width, converted.header.height);
  }

  // Play events with timing
  for (const event of timedEvents) {
    const adjustedDelay = event.delay / speedMultiplier;

    if (adjustedDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, adjustedDelay));
    }

    if (event.type === 'output') {
      terminal.write(event.data);
    } else if (event.type === 'resize' && terminal.setTerminalSize && event.cols && event.rows) {
      terminal.setTerminalSize(event.cols, event.rows);
    }
  }
}

/**
 * Dump entire cast content to terminal with batched writes for optimal performance.
 * Groups output events into chunks to balance speed and buffer limits (~1MB per batch).
 * Handles resize events by applying them between batches.
 *
 * @param terminal - DOM terminal instance with write() and setTerminalSize() methods
 * @param castContent - Raw cast file content
 * @returns Promise that resolves when dump is complete
 */
export async function dumpToTerminal(
  terminal: {
    write: (data: string, followCursor?: boolean) => void;
    setTerminalSize?: (cols: number, rows: number) => void;
  },
  castContent: string
): Promise<void> {
  const converted = convertCast(castContent);

  // Get initial terminal dimensions from header
  const initialCols = converted.header?.width || 80;
  const initialRows = converted.header?.height || 24;

  // Apply initial terminal size if we have resize capability
  if (terminal.setTerminalSize) {
    terminal.setTerminalSize(initialCols, initialRows);
  }

  // Batch size: ~1MB worth of data to stay well under buffer limits
  const maxBatchSize = 1024 * 1024; // 1MB
  let currentBatch = '';
  let currentBatchSize = 0;

  const flushBatch = () => {
    if (currentBatch.length > 0) {
      terminal.write(currentBatch, false); // Don't follow cursor during dump for performance
      currentBatch = '';
      currentBatchSize = 0;
    }
  };

  // Process events, batching output and handling resizes immediately
  for (const event of converted.events) {
    if (event.type === 'o') {
      // Output event - add to current batch
      if (event.data) {
        const dataSize = event.data.length;

        // If adding this data would exceed batch size, flush current batch first
        if (currentBatchSize + dataSize > maxBatchSize && currentBatch.length > 0) {
          flushBatch();
        }

        currentBatch += event.data;
        currentBatchSize += dataSize;
      }
    } else if (event.type === 'r') {
      // Resize event - flush current batch first, then resize
      flushBatch();

      const match = event.data.match(/^(\d+)x(\d+)$/);
      if (match && terminal.setTerminalSize) {
        const cols = Number.parseInt(match[1], 10);
        const rows = Number.parseInt(match[2], 10);
        terminal.setTerminalSize(cols, rows);
      }
    }
    // Ignore 'i' (input) events for dump
  }

  // Flush any remaining data
  flushBatch();
}

/**
 * Connect terminal to a streaming URL using Server-Sent Events (SSE).
 * Handles real-time terminal output, input, and resize events from the stream.
 * Returns connection object for cleanup and management.
 *
 * @param terminal - DOM terminal instance with write() and setTerminalSize() methods
 * @param streamUrl - URL endpoint for the SSE stream (e.g., /api/sessions/123/stream)
 * @returns Connection object with EventSource and cleanup methods
 */
export function connectToStream(
  terminal: {
    write: (data: string, followCursor?: boolean) => void;
    setTerminalSize?: (cols: number, rows: number) => void;
    dispatchEvent?: (event: CustomEvent) => void;
  },
  streamUrl: string
): {
  eventSource: EventSource;
  disconnect: () => void;
} {
  const eventSource = new EventSource(streamUrl);

  // Batching variables for performance
  let outputBuffer = '';
  let batchTimeout: number | null = null;
  const batchDelay = 16; // ~60fps for smooth streaming

  const flushOutputBuffer = () => {
    if (outputBuffer.length > 0) {
      terminal.write(outputBuffer, true);
      outputBuffer = '';
    }
    batchTimeout = null;
  };

  const addToOutputBuffer = (data: string) => {
    outputBuffer += data;

    // Schedule flush if not already scheduled
    if (batchTimeout === null) {
      batchTimeout = window.setTimeout(flushOutputBuffer, batchDelay);
    }
  };

  const disconnect = () => {
    if (batchTimeout !== null) {
      clearTimeout(batchTimeout);
      flushOutputBuffer();
    }

    // Force close the connection
    if (eventSource.readyState !== EventSource.CLOSED) {
      eventSource.close();
    }
  };

  // Handle incoming messages from the stream
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      logger.debug('SSE message received:', { type: Array.isArray(data) ? data[1] : 'header' });

      // Check if this is a header message with terminal dimensions
      if (data.version && data.width && data.height) {
        // Header message - set initial terminal size
        if (terminal.setTerminalSize) {
          terminal.setTerminalSize(data.width, data.height);
        }
        return;
      }

      // Check if this is a cast event array [timestamp, type, data]
      if (Array.isArray(data) && data.length >= 3) {
        const [_timestamp, type, eventData] = data;

        if (_timestamp === 'exit') {
          disconnect();

          if (terminal.dispatchEvent) {
            terminal.dispatchEvent(
              new CustomEvent('session-exit', {
                detail: {
                  exitCode: data[1],
                  sessionId: data[2] || null,
                },
                bubbles: true,
              })
            );
          }
        } else if (type === 'o') {
          // Output event - add to batch buffer
          addToOutputBuffer(eventData);
        } else if (type === 'r') {
          // Resize event - flush buffer first, then resize
          if (batchTimeout !== null) {
            clearTimeout(batchTimeout);
            flushOutputBuffer();
          }

          // Update terminal dimensions
          const match = eventData.match(/^(\d+)x(\d+)$/);
          if (match && terminal.setTerminalSize) {
            const cols = Number.parseInt(match[1], 10);
            const rows = Number.parseInt(match[2], 10);
            terminal.setTerminalSize(cols, rows);

            // Dispatch resize event if terminal supports it
            if (terminal.dispatchEvent) {
              terminal.dispatchEvent(
                new CustomEvent('terminal-resize', {
                  detail: { cols, rows },
                  bubbles: true,
                })
              );
            }
          }
        } else if (type === 'i') {
          // Ignore 'i' (input) events - those are for sending to server, not displaying
        } else {
          logger.error('unknown stream message format');
        }
      }
    } catch (error) {
      logger.error('failed to parse stream message:', error);
    }
  };

  // Handle connection errors
  eventSource.onerror = (error) => {
    logger.error('stream connection error:', error);

    if (eventSource.readyState === EventSource.CLOSED) {
      logger.debug('stream connection closed');
    }
  };

  // Handle connection open
  eventSource.onopen = () => {
    logger.debug(`stream connection established to: ${streamUrl}`);
  };

  return {
    eventSource,
    disconnect,
  };
}

// Maintain backwards compatibility by re-exporting as CastConverter
export const CastConverter = {
  convertCast,
  loadAndConvert,
  convertToOutputOnly,
  getTerminalDimensions,
  convertToTimedEvents,
  playOnTerminal,
  dumpToTerminal,
  connectToStream,
};
