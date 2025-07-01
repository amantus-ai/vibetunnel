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
  private pendingTitles: string[] = [];
  private lastOutputTime = Date.now();
  private idleThreshold: number;
  private maxWaitTime: number;
  private debug: boolean;
  private injectionTimer?: NodeJS.Timeout;
  private originalOnData?: (data: string) => void;

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
    const titleSequence = `\x1b]0;${title}\x07`;
    this.pendingTitles.push(titleSequence);

    if (this.debug) {
      logger.debug(`Queued title for safe injection: ${title}`);
    }

    // Try to inject immediately if we have a pending safe point
    this.tryInjectPendingTitles();
  }

  /**
   * Process PTY output and inject titles at safe points
   */
  processOutput(data: string): void {
    const buffer = Buffer.from(data, 'utf8');
    this.lastOutputTime = Date.now();

    // Analyze the stream for safe injection points
    const safePoints = this.analyzer.process(buffer);

    // If we have safe points and pending titles, inject them
    if (safePoints.length > 0 && this.pendingTitles.length > 0) {
      this.injectAtSafePoints(data, safePoints);
    } else {
      // No safe points found, forward data as-is
      this.originalOnData?.(data);
    }

    // Schedule idle check
    this.scheduleIdleCheck();
  }

  /**
   * Inject titles at safe points in the data stream
   */
  private injectAtSafePoints(data: string, safePoints: SafeInjectionPoint[]): void {
    let modifiedData = data;
    let injectionOffset = 0;

    // Sort safe points by position
    safePoints.sort((a, b) => a.position - b.position);

    for (const point of safePoints) {
      if (this.pendingTitles.length === 0) break;

      const title = this.pendingTitles.shift()!;
      const insertPos = point.position + injectionOffset;

      // Split data and inject title
      if (this.debug) {
        logger.debug(`Injecting at position ${insertPos} in data of length ${modifiedData.length}`);
      }
      modifiedData = modifiedData.slice(0, insertPos) + title + modifiedData.slice(insertPos);

      // Update offset for next injection
      injectionOffset += title.length;

      if (this.debug) {
        logger.debug(`Injected title at safe point: ${point.reason} (pos: ${point.position})`);
      }
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
    const idleTime = Date.now() - this.lastOutputTime;

    if (idleTime >= this.idleThreshold && this.pendingTitles.length > 0) {
      // Safe to inject during idle
      const titles = this.pendingTitles.splice(0, this.pendingTitles.length);
      const titleData = titles.join('');

      if (this.debug) {
        logger.debug(`Injecting ${titles.length} titles during idle period (${idleTime}ms idle)`);
      }

      // Write directly to PTY during idle period
      this.pty.write(titleData);
    }
  }

  /**
   * Try to inject pending titles if conditions are safe
   */
  private tryInjectPendingTitles(): void {
    if (this.pendingTitles.length === 0) return;

    // Schedule check for idle injection
    this.scheduleIdleCheck();
  }

  /**
   * Force injection of all pending titles (use with caution)
   */
  forceInject(): void {
    if (this.pendingTitles.length === 0) return;

    const titles = this.pendingTitles.splice(0, this.pendingTitles.length);
    const titleData = titles.join('');

    logger.warn(`Force injecting ${titles.length} titles`);
    this.pty.write(titleData);
  }

  /**
   * Clear all pending titles
   */
  clearPending(): void {
    this.pendingTitles = [];
    if (this.injectionTimer) {
      clearTimeout(this.injectionTimer);
      this.injectionTimer = undefined;
    }
  }

  /**
   * Get number of pending titles
   */
  getPendingCount(): number {
    return this.pendingTitles.length;
  }

  /**
   * Detach from PTY and cleanup
   */
  detach(): void {
    this.clearPending();
    this.originalOnData = undefined;
  }
}
