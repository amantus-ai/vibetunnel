/**
 * Error deduplication utility to prevent log spam
 *
 * This helper tracks and deduplicates repeated errors, logging them
 * at controlled intervals to avoid overwhelming the logs.
 */

export interface ErrorInfo {
  count: number;
  lastLogged: number;
  firstSeen: number;
}

export interface DeduplicationOptions {
  /** Minimum time between logging the same error (ms). Default: 60000 (1 minute) */
  minLogInterval?: number;
  /** Log a summary every N occurrences. Default: 100 */
  summaryInterval?: number;
  /** Maximum cache size before cleanup. Default: 100 */
  maxCacheSize?: number;
  /** Cache entry TTL (ms). Default: 300000 (5 minutes) */
  cacheEntryTTL?: number;
  /** Maximum length of error key. Default: 100 */
  maxKeyLength?: number;
  /** Function to extract error key. Default: uses error message + context substring */
  keyExtractor?: (error: unknown, context?: string) => string;
}

export class ErrorDeduplicator {
  private errorCache = new Map<string, ErrorInfo>();
  private options: Required<DeduplicationOptions>;

  constructor(options: DeduplicationOptions = {}) {
    this.options = {
      minLogInterval: options.minLogInterval ?? 60000,
      summaryInterval: options.summaryInterval ?? 100,
      maxCacheSize: options.maxCacheSize ?? 100,
      cacheEntryTTL: options.cacheEntryTTL ?? 300000,
      maxKeyLength: options.maxKeyLength ?? 100,
      keyExtractor: options.keyExtractor ?? this.defaultKeyExtractor,
    };
  }

  /**
   * Check if an error should be logged, and track it
   * @returns true if the error should be logged, false if it should be suppressed
   */
  shouldLog(error: unknown, context?: string): boolean {
    const errorKey = this.options.keyExtractor(error, context);
    const truncatedKey = errorKey.substring(0, this.options.maxKeyLength);
    const errorInfo = this.errorCache.get(truncatedKey);
    const now = Date.now();

    if (!errorInfo) {
      // First occurrence
      this.errorCache.set(truncatedKey, {
        count: 1,
        lastLogged: now,
        firstSeen: now,
      });
      this.cleanupCacheIfNeeded();
      return true;
    }

    // Increment count
    errorInfo.count++;

    // Check if enough time has passed
    if (now - errorInfo.lastLogged >= this.options.minLogInterval) {
      errorInfo.lastLogged = now;
      return true;
    }

    // Check if we should log a summary
    if (errorInfo.count % this.options.summaryInterval === 0) {
      errorInfo.lastLogged = now;
      return true;
    }

    return false;
  }

  /**
   * Get error statistics for a given error
   */
  getErrorStats(error: unknown, context?: string): ErrorInfo | undefined {
    const errorKey = this.options.keyExtractor(error, context);
    const truncatedKey = errorKey.substring(0, this.options.maxKeyLength);
    return this.errorCache.get(truncatedKey);
  }

  /**
   * Clear all cached errors
   */
  clear(): void {
    this.errorCache.clear();
  }

  /**
   * Get the number of unique errors being tracked
   */
  get size(): number {
    return this.errorCache.size;
  }

  /**
   * Default key extractor
   */
  private defaultKeyExtractor(error: unknown, context?: string): string {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const contextPart = context ? `:${context.substring(0, 30)}` : '';
    return `${errorMessage}${contextPart}`;
  }

  /**
   * Clean up old cache entries if cache is too large
   */
  private cleanupCacheIfNeeded(): void {
    if (this.errorCache.size <= this.options.maxCacheSize) {
      return;
    }

    const now = Date.now();
    const cutoff = now - this.options.cacheEntryTTL;

    // Find and remove old entries
    const entriesToDelete: string[] = [];
    for (const [key, info] of this.errorCache.entries()) {
      if (info.lastLogged < cutoff) {
        entriesToDelete.push(key);
      }
    }

    for (const key of entriesToDelete) {
      this.errorCache.delete(key);
    }

    // If still too large, remove oldest entries
    if (this.errorCache.size > this.options.maxCacheSize) {
      const sortedEntries = Array.from(this.errorCache.entries()).sort(
        (a, b) => a[1].lastLogged - b[1].lastLogged
      );

      const entriesToRemove = sortedEntries.slice(
        0,
        this.errorCache.size - this.options.maxCacheSize
      );
      for (const [key] of entriesToRemove) {
        this.errorCache.delete(key);
      }
    }
  }
}

/**
 * Format an error summary message
 */
export function formatErrorSummary(error: unknown, stats: ErrorInfo, context?: string): string {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const contextPart = context ? ` (context: ${context})` : '';
  const duration = Date.now() - stats.firstSeen;
  const durationStr = formatDuration(duration);

  return `Repeated error: ${stats.count} occurrences over ${durationStr}${contextPart} - ${errorMessage}`;
}

/**
 * Format a duration in milliseconds to a human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
}

/**
 * Create a singleton error deduplicator with default options
 */
export const defaultErrorDeduplicator = new ErrorDeduplicator();
