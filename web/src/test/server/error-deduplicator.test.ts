import { describe, expect, it } from 'vitest';
import { ErrorDeduplicator, formatErrorSummary } from '../../server/utils/error-deduplicator.js';

describe('ErrorDeduplicator', () => {
  it('should log first occurrence of an error', () => {
    const deduplicator = new ErrorDeduplicator();
    const error = new Error('Test error');

    expect(deduplicator.shouldLog(error)).toBe(true);
  });

  it('should suppress repeated errors within the time window', () => {
    const deduplicator = new ErrorDeduplicator({ minLogInterval: 1000 });
    const error = new Error('Test error');

    expect(deduplicator.shouldLog(error)).toBe(true);
    expect(deduplicator.shouldLog(error)).toBe(false);
    expect(deduplicator.shouldLog(error)).toBe(false);
  });

  it('should log error again after time window expires', async () => {
    const deduplicator = new ErrorDeduplicator({ minLogInterval: 50 });
    const error = new Error('Test error');

    expect(deduplicator.shouldLog(error)).toBe(true);
    expect(deduplicator.shouldLog(error)).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(deduplicator.shouldLog(error)).toBe(true);
  });

  it('should log summary at specified intervals', () => {
    const deduplicator = new ErrorDeduplicator({
      minLogInterval: 60000,
      summaryInterval: 5,
    });
    const error = new Error('Test error');

    expect(deduplicator.shouldLog(error)).toBe(true); // 1st
    expect(deduplicator.shouldLog(error)).toBe(false); // 2nd
    expect(deduplicator.shouldLog(error)).toBe(false); // 3rd
    expect(deduplicator.shouldLog(error)).toBe(false); // 4th
    expect(deduplicator.shouldLog(error)).toBe(true); // 5th - summary
  });

  it('should track error statistics', () => {
    const deduplicator = new ErrorDeduplicator();
    const error = new Error('Test error');

    expect(deduplicator.getErrorStats(error)).toBeUndefined();

    deduplicator.shouldLog(error);
    const stats = deduplicator.getErrorStats(error);
    expect(stats).toBeDefined();
    expect(stats?.count).toBe(1);

    deduplicator.shouldLog(error);
    deduplicator.shouldLog(error);

    const updatedStats = deduplicator.getErrorStats(error);
    expect(updatedStats?.count).toBe(3);
  });

  it('should use custom key extractor', () => {
    const deduplicator = new ErrorDeduplicator({
      keyExtractor: (error) => {
        return error instanceof Error ? error.message.toLowerCase() : 'unknown';
      },
    });

    const error1 = new Error('Test Error');
    const error2 = new Error('test error');

    expect(deduplicator.shouldLog(error1)).toBe(true);
    expect(deduplicator.shouldLog(error2)).toBe(false); // Same key due to lowercase
  });

  it('should handle context in key extraction', () => {
    const deduplicator = new ErrorDeduplicator();
    const error = new Error('Test error');

    expect(deduplicator.shouldLog(error, 'context1')).toBe(true);
    expect(deduplicator.shouldLog(error, 'context2')).toBe(true); // Different context
    expect(deduplicator.shouldLog(error, 'context1')).toBe(false); // Same context
  });

  it('should clean up old entries when cache is full', () => {
    const deduplicator = new ErrorDeduplicator({
      maxCacheSize: 3,
      cacheEntryTTL: 50,
    });

    // Add entries
    deduplicator.shouldLog(new Error('Error 1'));
    deduplicator.shouldLog(new Error('Error 2'));
    deduplicator.shouldLog(new Error('Error 3'));

    expect(deduplicator.size).toBe(3);

    // Wait for TTL
    setTimeout(() => {
      // Add one more to trigger cleanup
      deduplicator.shouldLog(new Error('Error 4'));

      // Should have cleaned up old entries
      expect(deduplicator.size).toBeLessThanOrEqual(3);
    }, 60);
  });

  it('should clear all errors', () => {
    const deduplicator = new ErrorDeduplicator();

    deduplicator.shouldLog(new Error('Error 1'));
    deduplicator.shouldLog(new Error('Error 2'));
    expect(deduplicator.size).toBe(2);

    deduplicator.clear();
    expect(deduplicator.size).toBe(0);
  });
});

describe('formatErrorSummary', () => {
  it('should format error summary with count and duration', () => {
    const error = new Error('Test error');
    const stats = {
      count: 10,
      lastLogged: Date.now(),
      firstSeen: Date.now() - 5000,
    };

    const summary = formatErrorSummary(error, stats);
    expect(summary).toContain('10 occurrences');
    expect(summary).toContain('5s');
    expect(summary).toContain('Test error');
  });

  it('should include context in summary', () => {
    const error = new Error('Test error');
    const stats = {
      count: 5,
      lastLogged: Date.now(),
      firstSeen: Date.now() - 60000,
    };

    const summary = formatErrorSummary(error, stats, 'session-123');
    expect(summary).toContain('context: session-123');
  });

  it('should format different duration units', () => {
    const error = new Error('Test');

    // Milliseconds
    let stats = { count: 1, lastLogged: Date.now(), firstSeen: Date.now() - 500 };
    expect(formatErrorSummary(error, stats)).toContain('500ms');

    // Seconds
    stats = { count: 1, lastLogged: Date.now(), firstSeen: Date.now() - 30000 };
    expect(formatErrorSummary(error, stats)).toContain('30s');

    // Minutes
    stats = { count: 1, lastLogged: Date.now(), firstSeen: Date.now() - 120000 };
    expect(formatErrorSummary(error, stats)).toContain('2m');

    // Hours
    stats = { count: 1, lastLogged: Date.now(), firstSeen: Date.now() - 7200000 };
    expect(formatErrorSummary(error, stats)).toContain('2h');
  });
});
