/**
 * Pruning Detector - Unified detection of terminal pruning sequences
 *
 * This module provides a single source of truth for detecting terminal sequences
 * that indicate the terminal buffer should be pruned (cleared). It's used by both:
 * - AsciinemaWriter: Real-time detection during recording
 * - CastOutputHub: Retroactive detection during playback/tailing
 *
 * Pruning helps prevent session files from growing indefinitely by identifying
 * points where old terminal content can be safely discarded.
 */

import { createLogger } from './logger.js';

const logger = createLogger('PruningDetector');

/**
 * Comprehensive list of ANSI sequences that warrant pruning.
 * These sequences indicate the terminal has been cleared or reset,
 * making previous content unnecessary for playback.
 */
export const PRUNE_SEQUENCES = [
  '\x1b[3J', // Clear scrollback buffer (common)
  '\x1bc', // RIS - Full terminal reset
  '\x1b[2J', // Clear screen (common)
  '\x1b[H\x1b[J', // Home cursor + clear (older pattern)
  '\x1b[H\x1b[2J', // Home cursor + clear screen variant
  '\x1b[?1049h', // Enter alternate screen (vim, less, etc)
  '\x1b[?1049l', // Exit alternate screen
  '\x1b[?47h', // Save screen and enter alternate screen (older)
  '\x1b[?47l', // Restore screen and exit alternate screen (older)
] as const;

/**
 * Result of pruning sequence detection
 */
export interface PruningDetectionResult {
  sequence: string;
  index: number;
}

/**
 * Detect the last pruning sequence in raw terminal data.
 *
 * @param data - Raw terminal output data
 * @returns Detection result with sequence and index, or null if not found
 */
export function detectLastPruningSequence(data: string): PruningDetectionResult | null {
  let lastIndex = -1;
  let lastSequence = '';

  for (const sequence of PRUNE_SEQUENCES) {
    const index = data.lastIndexOf(sequence);
    if (index > lastIndex) {
      lastIndex = index;
      lastSequence = sequence;
    }
  }

  if (lastIndex === -1) {
    return null;
  }

  return {
    sequence: lastSequence,
    index: lastIndex,
  };
}

/**
 * Check if data contains any pruning sequence.
 *
 * @param data - Terminal data to check
 * @returns true if any pruning sequence is found
 */
export function containsPruningSequence(data: string): boolean {
  return PRUNE_SEQUENCES.some((sequence) => data.includes(sequence));
}

/**
 * Find the position of the last pruning sequence and where it ends.
 *
 * @param data - Terminal data to search
 * @returns Object with sequence and end position, or null if not found
 */
export function findLastPrunePoint(data: string): { sequence: string; position: number } | null {
  const result = detectLastPruningSequence(data);
  if (!result) {
    return null;
  }

  return {
    sequence: result.sequence,
    position: result.index + result.sequence.length,
  };
}

/**
 * Calculate the exact byte position of a sequence within an asciinema event.
 * This accounts for JSON encoding and the event format: [timestamp, "o", "data"]
 *
 * @param eventStartPos - Byte position where the event starts in the file
 * @param timestamp - Event timestamp
 * @param fullData - Complete data string that will be written
 * @param sequenceIndex - Character index of the sequence in the data
 * @param sequenceLength - Length of the sequence in characters
 * @returns Exact byte position where the sequence ends in the file
 */
export function calculateSequenceBytePosition(
  eventStartPos: number,
  timestamp: number,
  fullData: string,
  sequenceIndex: number,
  sequenceLength: number
): number {
  // Calculate the data up to where the sequence ends
  const dataUpToSequenceEnd = fullData.substring(0, sequenceIndex + sequenceLength);

  // Create the event array prefix: [timestamp,"o","
  const eventPrefix = JSON.stringify([timestamp, 'o', '']).slice(0, -1); // Remove trailing quote
  const prefixBytes = Buffer.from(eventPrefix, 'utf8').length;

  // Calculate bytes for the data portion up to sequence end
  const sequenceBytesInData = Buffer.from(dataUpToSequenceEnd, 'utf8').length;

  // Total position is: event start + prefix bytes + data bytes
  return eventStartPos + prefixBytes + sequenceBytesInData;
}

/**
 * Parse an asciinema event line and check for pruning sequences.
 *
 * @param line - JSON line from asciinema file
 * @returns Detection result with additional metadata, or null
 */
export function checkAsciinemaEventForPruning(line: string): {
  sequence: string;
  dataIndex: number;
  timestamp: number;
  eventType: string;
} | null {
  try {
    const parsed = JSON.parse(line);

    // Check if it's a valid event array
    if (!Array.isArray(parsed) || parsed.length < 3) {
      return null;
    }

    const [timestamp, eventType, data] = parsed;

    // Only check output events
    if (eventType !== 'o' || typeof data !== 'string') {
      return null;
    }

    // Check for pruning sequences
    const result = detectLastPruningSequence(data);
    if (!result) {
      return null;
    }

    return {
      sequence: result.sequence,
      dataIndex: result.index,
      timestamp,
      eventType,
    };
  } catch (error) {
    // Invalid JSON or parsing error
    logger.debug(`Failed to parse asciinema line: ${error}`);
    return null;
  }
}

/**
 * Calculate the byte position of a pruning sequence found in an asciinema file.
 * This is used when scanning existing files to find exact positions.
 *
 * @param fileOffset - Current byte offset in the file
 * @param eventLine - The full JSON line containing the event
 * @param sequenceEndIndex - Character index where the sequence ends in the data
 * @returns Exact byte position where the sequence ends
 */
export function calculatePruningPositionInFile(
  fileOffset: number,
  eventLine: string,
  sequenceEndIndex: number
): number {
  // The fileOffset is at the end of this line
  // We need to find where within the line the sequence ends

  // Parse the event to get the data
  const event = JSON.parse(eventLine);
  const data = event[2];

  // Find where the data portion starts in the JSON string
  // This is after: [timestamp,"o","
  const jsonPrefix = JSON.stringify([event[0], event[1], '']).slice(0, -1);
  const prefixLength = jsonPrefix.length;

  // Calculate how many bytes from start of line to sequence end
  const dataUpToSequence = data.substring(0, sequenceEndIndex);
  const dataBytes = Buffer.from(dataUpToSequence, 'utf8').length;

  // The position is: start of line + prefix + data bytes
  const lineStart = fileOffset - Buffer.from(`${eventLine}\n`, 'utf8').length;
  return lineStart + prefixLength + dataBytes;
}

/**
 * Log detection of a pruning sequence in a consistent format.
 *
 * @param sequence - The detected sequence
 * @param position - Byte position in the file
 * @param context - Additional context for the log
 */
export function logPruningDetection(
  sequence: string,
  position: number,
  context: string = ''
): void {
  const escapedSequence = sequence.split('\x1b').join('\\x1b');
  logger.debug(
    `Detected pruning sequence '${escapedSequence}' at byte position ${position}` +
      (context ? ` ${context}` : '')
  );
}

/**
 * Get a human-readable name for a pruning sequence.
 *
 * @param sequence - The pruning sequence
 * @returns Description of what the sequence does
 */
export function getSequenceDescription(sequence: string): string {
  switch (sequence) {
    case '\x1b[3J':
      return 'Clear scrollback buffer';
    case '\x1bc':
      return 'Terminal reset (RIS)';
    case '\x1b[2J':
      return 'Clear screen';
    case '\x1b[H\x1b[J':
      return 'Home cursor + clear';
    case '\x1b[H\x1b[2J':
      return 'Home cursor + clear screen';
    case '\x1b[?1049h':
      return 'Enter alternate screen';
    case '\x1b[?1049l':
      return 'Exit alternate screen';
    case '\x1b[?47h':
      return 'Save screen (legacy)';
    case '\x1b[?47l':
      return 'Restore screen (legacy)';
    default:
      return 'Unknown sequence';
  }
}
