/**
 * SafePTYWriter - Safe title injection for PTY streams
 *
 * This class handles safe injection of terminal title sequences into PTY output
 * streams to prevent corruption of ANSI escape sequences and UTF-8 characters.
 */

import { EventEmitter } from 'events';
import type { IPty } from 'node-pty';
import { createLogger } from '../utils/logger.js';
import { PTYStreamAnalyzer, type SafeInjectionPoint } from './stream-analyzer.js';

const logger = createLogger('safe-pty-writer');

export interface SafePTYWriterOptions {
  /** Minimum idle time in ms before considering injection safe */
  idleThreshold?: number;
  /** Maximum time to wait for safe injection point in ms */
  maxWaitTime?: number;
  /** Enable debug logging */
  debug?: boolean;
}

export class SafePTYWriter extends EventEmitter {
  private pty: IPty;
  private analyzer = new PTYStreamAnalyzer();
  private pendingTitle: string | null = null;
  private lastOutputTime = Date.now();
  private idleThreshold: number;
  private maxWaitTime: number;
  private debug: boolean;
  private injectionTimer?: NodeJS.Timeout;
  private originalOnData?: (data: string) => void;
  private isProcessingOutput = false;

  // Regular expression to match control characters (except for the ones we need for the title sequence)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: We need to match control characters for sanitization
  private static readonly CONTROL_CHAR_REGEX = /[\x00-\x06\x08-\x1A\x1C-\x1F\x7F-\x9F]/g;

  constructor(pty: IPty, options: SafePTYWriterOptions = {}) {
    super();
    this.pty = pty;
    this.idleThreshold = options.idleThreshold ?? 50;
    this.maxWaitTime = options.maxWaitTime ?? 1000;
    this.debug = options.debug ?? false;
  }

  /**
   * Attach to PTY output stream and start processing
   */
  attach(onData: (data: string) => void): void {
    this.originalOnData = onData;

    // Intercept PTY data
    this.pty.onData((data: string) => {
      this.processOutput(data);
    });
  }

  /**
   * Queue a title for safe injection
   */
  queueTitle(title: string): void {
    // Sanitize title to prevent injection attacks
    const sanitized = this.sanitizeTitle(title);
    const titleSequence = `\x1b]0;${sanitized}\x07`;
    this.pendingTitle = titleSequence;

    if (this.debug) {
      logger.debug(`Queued title for safe injection: ${sanitized}`);
      if (title !== sanitized) {
        logger.debug(`Title was sanitized from: ${title}`);
      }
    }

    // Try to inject immediately if we have a pending safe point
    this.tryInjectPendingTitle();
  }

  /**
   * Process PTY output and inject titles at safe points
   */
  processOutput(data: string): void {
    const buffer = Buffer.from(data, 'utf8');
    this.lastOutputTime = Date.now();
    this.isProcessingOutput = true;

    try {
      // Analyze the stream for safe injection points
      const safePoints = this.analyzer.process(buffer);

      // If we have safe points and pending title, inject it
      if (safePoints.length > 0 && this.pendingTitle) {
        this.injectAtSafePoints(data, safePoints);
      } else {
        // No safe points found, forward data as-is
        this.originalOnData?.(data);
      }
    } finally {
      this.isProcessingOutput = false;
    }

    // Schedule idle check
    this.scheduleIdleCheck();
  }

  /**
   * Inject titles at safe points in the data stream
   */
  private injectAtSafePoints(data: string, safePoints: SafeInjectionPoint[]): void {
    if (!this.pendingTitle) {
      this.originalOnData?.(data);
      return;
    }

    // Use the first safe point
    const point = safePoints[0];
    const title = this.pendingTitle;
    this.pendingTitle = null;

    // Split data and inject title
    if (this.debug) {
      logger.debug(`Injecting at position ${point.position} in data of length ${data.length}`);
    }
    const modifiedData = data.slice(0, point.position) + title + data.slice(point.position);

    if (this.debug) {
      logger.debug(`Injected title at safe point: ${point.reason} (pos: ${point.position})`);
    }

    // Forward modified data
    this.originalOnData?.(modifiedData);
  }

  /**
   * Schedule check for idle injection opportunity
   */
  private scheduleIdleCheck(): void {
    // Clear existing timer
    if (this.injectionTimer) {
      clearTimeout(this.injectionTimer);
    }

    // Schedule new check
    this.injectionTimer = setTimeout(() => {
      this.checkIdleInjection();
    }, this.idleThreshold);
  }

  /**
   * Check if we can inject during idle period
   */
  private checkIdleInjection(): void {
    // Don't inject if we're currently processing output
    if (this.isProcessingOutput) {
      // Reschedule check
      this.scheduleIdleCheck();
      return;
    }

    const now = Date.now();
    const idleTime = now - this.lastOutputTime;

    if (idleTime >= this.idleThreshold && this.pendingTitle) {
      // Double-check that we're still idle
      if (now - this.lastOutputTime >= this.idleThreshold && !this.isProcessingOutput) {
        // Safe to inject during idle
        const title = this.pendingTitle;
        this.pendingTitle = null;

        if (this.debug) {
          logger.debug(`Injecting title during idle period (${idleTime}ms idle)`);
        }

        this.injectTitle(title);
      } else {
        // Race condition detected, reschedule
        this.scheduleIdleCheck();
      }
    }
  }

  /**
   * Try to inject pending title if conditions are safe
   */
  private tryInjectPendingTitle(): void {
    if (!this.pendingTitle) return;

    // Schedule check for idle injection
    this.scheduleIdleCheck();
  }

  /**
   * Inject title with error handling
   */
  private injectTitle(title: string): void {
    try {
      this.pty.write(title);
      if (this.debug) {
        logger.debug(`Successfully injected title sequence`);
      }
    } catch (error) {
      logger.error('Failed to inject title:', error);
      // Clear pending title on error to prevent retries
      if (this.pendingTitle === title) {
        this.pendingTitle = null;
      }
    }
  }

  /**
   * Sanitize title to prevent injection attacks
   */
  private sanitizeTitle(title: string): string {
    // Remove control characters that could break the terminal
    let sanitized = title.replace(SafePTYWriter.CONTROL_CHAR_REGEX, '');

    // Limit title length to prevent buffer overflow
    const maxLength = 256;
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength);
    }

    return sanitized;
  }

  /**
   * Force injection of all pending titles (use with caution)
   */
  forceInject(): void {
    if (!this.pendingTitle) return;

    const title = this.pendingTitle;
    this.pendingTitle = null;

    logger.warn('Force injecting title');
    this.injectTitle(title);
  }

  /**
   * Clear all pending titles
   */
  clearPending(): void {
    this.pendingTitle = null;
    if (this.injectionTimer) {
      clearTimeout(this.injectionTimer);
      this.injectionTimer = undefined;
    }
  }

  /**
   * Get number of pending titles
   */
  getPendingCount(): number {
    return this.pendingTitle ? 1 : 0;
  }

  /**
   * Detach from PTY and cleanup
   */
  detach(): void {
    this.clearPending();
    this.originalOnData = undefined;
  }
}
