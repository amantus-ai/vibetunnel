/**
 * PTYStreamAnalyzer - Analyzes PTY output streams for safe injection points
 *
 * This class tracks the state of PTY output streams to identify safe points
 * where terminal title sequences can be injected without corrupting the output.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('pty-stream-analyzer');

export interface SafeInjectionPoint {
  /** Position in the buffer where injection is safe */
  position: number;
  /** Reason why this point is safe */
  reason: 'newline' | 'prompt' | 'sequence_end' | 'idle' | 'carriage_return';
  /** Confidence level (0-100) */
  confidence: number;
}

enum StreamState {
  NORMAL,
  ESCAPE_START, // Just saw ESC (0x1B)
  CSI_SEQUENCE, // In CSI sequence (ESC[)
  OSC_SEQUENCE, // In OSC sequence (ESC])
  DCS_SEQUENCE, // In DCS sequence (ESCP)
  APC_SEQUENCE, // In APC sequence (ESC_)
  PM_SEQUENCE, // In PM sequence (ESC^)
  UTF8_MULTIBYTE, // In multi-byte UTF-8 character
  PROMPT_DETECTED, // Detected a shell prompt pattern
}

export class PTYStreamAnalyzer {
  private state = StreamState.NORMAL;
  private escapeBuffer = '';
  private utf8BytesRemaining = 0;
  private utf8Buffer: number[] = [];
  private lastByte: number | null = null;
  private consecutiveNormalBytes = 0;
  private promptPatternBuffer = '';
  private recentBytesCount = 0;
  private escapeStartTime?: number;

  // Confidence levels for different injection points
  private static readonly CONFIDENCE = {
    NEWLINE: 100,
    CARRIAGE_RETURN: 90,
    PROMPT: 85,
    SEQUENCE_END: 80,
    SIMPLE_ESCAPE_END: 70,
  } as const;

  // Maximum escape sequence buffer size to prevent memory issues
  private static readonly MAX_ESCAPE_BUFFER_SIZE = 1024;

  // Escape sequence timeout to handle malformed sequences
  private static readonly ESCAPE_TIMEOUT_MS = 1000;

  // Common prompt patterns
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Terminal prompt patterns need control characters
  private readonly promptPatterns = [
    /\$ $/, // Bash/sh prompt ending
    /# $/, // Root prompt ending
    /> $/, // Fish/PowerShell prompt ending
    /❯ $/, // Modern prompt ending (U+276F)
    /» $/, // Alternative prompt ending (U+00BB)
    /\) $/, // Python/Node REPL
    /\]: $/, // iPython prompt
  ];

  /**
   * Process a buffer and identify safe injection points
   */
  process(buffer: Buffer): SafeInjectionPoint[] {
    const safePoints: SafeInjectionPoint[] = [];

    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i];
      const point = this.processByte(byte, i);

      if (point) {
        safePoints.push(point);
      }

      this.lastByte = byte;
      this.recentBytesCount++;
    }

    return safePoints;
  }

  /**
   * Process a single byte and return injection point if safe
   */
  private processByte(byte: number, position: number): SafeInjectionPoint | null {
    // Update prompt pattern buffer
    this.updatePromptBuffer(byte);

    // Handle UTF-8 multibyte sequences
    if (this.state === StreamState.UTF8_MULTIBYTE) {
      if (this.utf8BytesRemaining > 0) {
        this.utf8Buffer.push(byte);
        this.utf8BytesRemaining--;
        if (this.utf8BytesRemaining === 0) {
          // UTF-8 sequence complete, add to prompt buffer
          try {
            const utf8String = Buffer.from(this.utf8Buffer).toString('utf8');
            this.promptPatternBuffer += utf8String;
            // Keep buffer size reasonable
            if (this.promptPatternBuffer.length > 20) {
              this.promptPatternBuffer = this.promptPatternBuffer.slice(-20);
            }
          } catch (_e) {
            // Invalid UTF-8 sequence, ignore
          }
          this.utf8Buffer = [];
          this.state = StreamState.NORMAL;
        }
        return null;
      }
    }

    // Check for UTF-8 start byte
    if ((byte & 0x80) !== 0) {
      if ((byte & 0xe0) === 0xc0) {
        this.utf8BytesRemaining = 1; // 2-byte sequence
        this.utf8Buffer = [byte];
        this.state = StreamState.UTF8_MULTIBYTE;
        return null;
      } else if ((byte & 0xf0) === 0xe0) {
        this.utf8BytesRemaining = 2; // 3-byte sequence
        this.utf8Buffer = [byte];
        this.state = StreamState.UTF8_MULTIBYTE;
        return null;
      } else if ((byte & 0xf8) === 0xf0) {
        this.utf8BytesRemaining = 3; // 4-byte sequence
        this.utf8Buffer = [byte];
        this.state = StreamState.UTF8_MULTIBYTE;
        return null;
      } else if ((byte & 0xc0) === 0x80) {
        // UTF-8 continuation byte without start byte
        return null;
      }
    }

    // State machine for ANSI escape sequences
    switch (this.state) {
      case StreamState.NORMAL:
        return this.handleNormalState(byte, position);

      case StreamState.ESCAPE_START:
        return this.handleEscapeStart(byte, position);

      case StreamState.CSI_SEQUENCE:
        return this.handleCSISequence(byte, position);

      case StreamState.OSC_SEQUENCE:
        return this.handleOSCSequence(byte, position);

      case StreamState.DCS_SEQUENCE:
        return this.handleDCSSequence(byte, position);

      case StreamState.APC_SEQUENCE:
        return this.handleAPCSequence(byte, position);

      case StreamState.PM_SEQUENCE:
        return this.handlePMSequence(byte, position);

      case StreamState.UTF8_MULTIBYTE:
        // This state is now handled above in the UTF-8 check
        return null;

      default:
        return null;
    }
  }

  /**
   * Handle normal (non-escape) state
   */
  private handleNormalState(byte: number, position: number): SafeInjectionPoint | null {
    // ESC starts escape sequence
    if (byte === 0x1b) {
      this.state = StreamState.ESCAPE_START;
      this.escapeBuffer = '\x1B';
      this.consecutiveNormalBytes = 0;
      return null;
    }

    this.consecutiveNormalBytes++;

    // Check for safe injection points

    // 1. After newline (highest confidence)
    if (byte === 0x0a) {
      return {
        position: position + 1,
        reason: 'newline',
        confidence: PTYStreamAnalyzer.CONFIDENCE.NEWLINE,
      };
    }

    // 2. After carriage return (high confidence)
    if (byte === 0x0d) {
      return {
        position: position + 1,
        reason: 'carriage_return',
        confidence: PTYStreamAnalyzer.CONFIDENCE.CARRIAGE_RETURN,
      };
    }

    // 3. After prompt patterns (high confidence)
    if (this.shouldCheckPrompts() && this.isPromptPattern()) {
      this.state = StreamState.PROMPT_DETECTED;
      return {
        position: position + 1,
        reason: 'prompt',
        confidence: PTYStreamAnalyzer.CONFIDENCE.PROMPT,
      };
    }

    return null;
  }

  /**
   * Handle escape sequence start
   */
  private handleEscapeStart(byte: number, position: number): SafeInjectionPoint | null {
    // Check for escape buffer overflow
    if (this.escapeBuffer.length >= PTYStreamAnalyzer.MAX_ESCAPE_BUFFER_SIZE) {
      logger.warn('Escape sequence exceeded maximum length, resetting to normal');
      this.state = StreamState.NORMAL;
      this.escapeBuffer = '';
      return null;
    }

    this.escapeBuffer += String.fromCharCode(byte);

    // Determine sequence type
    switch (byte) {
      case 0x5b: // [
        this.state = StreamState.CSI_SEQUENCE;
        break;
      case 0x5d: // ]
        this.state = StreamState.OSC_SEQUENCE;
        break;
      case 0x50: // P
        this.state = StreamState.DCS_SEQUENCE;
        break;
      case 0x5f: // _
        this.state = StreamState.APC_SEQUENCE;
        break;
      case 0x5e: // ^
        this.state = StreamState.PM_SEQUENCE;
        break;
      default:
        // Two-character escape sequence
        this.state = StreamState.NORMAL;
        this.escapeBuffer = '';
        // Safe after simple escape sequences
        return {
          position: position + 1,
          reason: 'sequence_end',
          confidence: PTYStreamAnalyzer.CONFIDENCE.SIMPLE_ESCAPE_END,
        };
    }

    return null;
  }

  /**
   * Handle CSI (Control Sequence Introducer) sequences
   */
  private handleCSISequence(byte: number, position: number): SafeInjectionPoint | null {
    // Check for escape buffer overflow
    if (this.escapeBuffer.length >= PTYStreamAnalyzer.MAX_ESCAPE_BUFFER_SIZE) {
      logger.warn('CSI sequence exceeded maximum length, resetting to normal');
      this.state = StreamState.NORMAL;
      this.escapeBuffer = '';
      return null;
    }

    this.escapeBuffer += String.fromCharCode(byte);

    // CSI sequences end with a letter (0x40-0x7E)
    if (byte >= 0x40 && byte <= 0x7e) {
      this.state = StreamState.NORMAL;
      this.escapeBuffer = '';

      // Safe after CSI sequence
      return {
        position: position + 1,
        reason: 'sequence_end',
        confidence: PTYStreamAnalyzer.CONFIDENCE.SEQUENCE_END,
      };
    }

    // Still in sequence
    return null;
  }

  /**
   * Handle OSC (Operating System Command) sequences
   */
  private handleOSCSequence(byte: number, position: number): SafeInjectionPoint | null {
    // Check for escape buffer overflow
    if (this.escapeBuffer.length >= PTYStreamAnalyzer.MAX_ESCAPE_BUFFER_SIZE) {
      logger.warn('OSC sequence exceeded maximum length, resetting to normal');
      this.state = StreamState.NORMAL;
      this.escapeBuffer = '';
      return null;
    }

    this.escapeBuffer += String.fromCharCode(byte);

    // OSC sequences end with ST (ESC\) or BEL
    if (
      byte === 0x07 || // BEL
      (this.lastByte === 0x1b && byte === 0x5c)
    ) {
      // ESC\
      this.state = StreamState.NORMAL;
      this.escapeBuffer = '';

      // Safe after OSC sequence
      return {
        position: position + 1,
        reason: 'sequence_end',
        confidence: PTYStreamAnalyzer.CONFIDENCE.SEQUENCE_END,
      };
    }

    return null;
  }

  /**
   * Handle DCS (Device Control String) sequences
   */
  private handleDCSSequence(byte: number, position: number): SafeInjectionPoint | null {
    // Check for escape buffer overflow
    if (this.escapeBuffer.length >= PTYStreamAnalyzer.MAX_ESCAPE_BUFFER_SIZE) {
      logger.warn('DCS sequence exceeded maximum length, resetting to normal');
      this.state = StreamState.NORMAL;
      this.escapeBuffer = '';
      return null;
    }

    this.escapeBuffer += String.fromCharCode(byte);

    // DCS sequences end with ST (ESC\)
    if (this.lastByte === 0x1b && byte === 0x5c) {
      this.state = StreamState.NORMAL;
      this.escapeBuffer = '';

      // Safe after DCS sequence
      return {
        position: position + 1,
        reason: 'sequence_end',
        confidence: PTYStreamAnalyzer.CONFIDENCE.SEQUENCE_END,
      };
    }

    return null;
  }

  /**
   * Handle APC (Application Program Command) sequences
   */
  private handleAPCSequence(byte: number, position: number): SafeInjectionPoint | null {
    // Check for escape buffer overflow
    if (this.escapeBuffer.length >= PTYStreamAnalyzer.MAX_ESCAPE_BUFFER_SIZE) {
      logger.warn('APC sequence exceeded maximum length, resetting to normal');
      this.state = StreamState.NORMAL;
      this.escapeBuffer = '';
      return null;
    }

    this.escapeBuffer += String.fromCharCode(byte);

    // APC sequences end with ST (ESC\)
    if (this.lastByte === 0x1b && byte === 0x5c) {
      this.state = StreamState.NORMAL;
      this.escapeBuffer = '';
      this.escapeStartTime = undefined;

      // Safe after APC sequence
      return {
        position: position + 1,
        reason: 'sequence_end',
        confidence: PTYStreamAnalyzer.CONFIDENCE.SEQUENCE_END,
      };
    }

    return null;
  }

  /**
   * Handle PM (Privacy Message) sequences
   */
  private handlePMSequence(byte: number, position: number): SafeInjectionPoint | null {
    // Check for escape buffer overflow
    if (this.escapeBuffer.length >= PTYStreamAnalyzer.MAX_ESCAPE_BUFFER_SIZE) {
      logger.warn('PM sequence exceeded maximum length, resetting to normal');
      this.state = StreamState.NORMAL;
      this.escapeBuffer = '';
      return null;
    }

    this.escapeBuffer += String.fromCharCode(byte);

    // PM sequences end with ST (ESC\)
    if (this.lastByte === 0x1b && byte === 0x5c) {
      this.state = StreamState.NORMAL;
      this.escapeBuffer = '';
      this.escapeStartTime = undefined;

      // Safe after PM sequence
      return {
        position: position + 1,
        reason: 'sequence_end',
        confidence: PTYStreamAnalyzer.CONFIDENCE.SEQUENCE_END,
      };
    }

    return null;
  }

  /**
   * Update prompt pattern buffer
   */
  private updatePromptBuffer(byte: number): void {
    // Only add printable ASCII characters and completed UTF-8 sequences
    if (this.state === StreamState.NORMAL) {
      if (byte >= 0x20 && byte <= 0x7e) {
        // Printable ASCII
        this.promptPatternBuffer += String.fromCharCode(byte);
      } else if (byte === 0x20 || byte === 0x09) {
        // Space or tab
        this.promptPatternBuffer += String.fromCharCode(byte);
      }
    }

    // Keep buffer size reasonable
    if (this.promptPatternBuffer.length > 20) {
      this.promptPatternBuffer = this.promptPatternBuffer.slice(-20);
    }
  }

  /**
   * Check if we should check for prompt patterns
   */
  private shouldCheckPrompts(): boolean {
    // Only check prompts when we have enough buffer and haven't processed too many recent bytes
    return this.promptPatternBuffer.length >= 2 && this.recentBytesCount < 100;
  }

  /**
   * Check if current buffer matches a prompt pattern
   */
  private isPromptPattern(): boolean {
    const matches = this.promptPatterns.some((pattern) => pattern.test(this.promptPatternBuffer));
    // Debug logging for test
    if (this.promptPatternBuffer.includes('❯')) {
      logger.debug(
        `Prompt buffer: ${JSON.stringify(this.promptPatternBuffer)}, matches: ${matches}`
      );
    }
    return matches;
  }

  /**
   * Reset analyzer state
   */
  reset(): void {
    this.state = StreamState.NORMAL;
    this.escapeBuffer = '';
    this.utf8BytesRemaining = 0;
    this.utf8Buffer = [];
    this.lastByte = null;
    this.consecutiveNormalBytes = 0;
    this.promptPatternBuffer = '';
    this.recentBytesCount = 0;
  }

  /**
   * Get current state (for debugging)
   */
  getState(): {
    state: StreamState;
    inEscape: boolean;
    utf8Remaining: number;
  } {
    return {
      state: this.state,
      inEscape: this.state !== StreamState.NORMAL,
      utf8Remaining: this.utf8BytesRemaining,
    };
  }
}
