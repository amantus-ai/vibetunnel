// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatSessionDuration } from './time';

describe('formatSessionDuration', () => {
  it('should format duration with no time elapsed', () => {
    const now = new Date();
    expect(formatSessionDuration(now.toISOString())).toBe('0s');
  });

  it('should format duration in seconds', () => {
    const now = Date.now();
    const thirtySecondsAgo = new Date(now - 30000);
    expect(formatSessionDuration(thirtySecondsAgo.toISOString())).toBe('30s');
  });

  it('should format duration in minutes and seconds', () => {
    const now = Date.now();
    const twoMinutesAgo = new Date(now - 125000); // 2m 5s
    expect(formatSessionDuration(twoMinutesAgo.toISOString())).toBe('2m 5s');
  });

  it('should format duration in hours, minutes, and seconds', () => {
    const now = Date.now();
    const hourAndHalfAgo = new Date(now - 5430000); // 1h 30m 30s
    expect(formatSessionDuration(hourAndHalfAgo.toISOString())).toBe('1h 30m');
  });

  it('should format duration in days', () => {
    const now = Date.now();
    const twoDaysAgo = new Date(now - 172800000); // 2 days
    expect(formatSessionDuration(twoDaysAgo.toISOString())).toBe('2d 0h');
  });

  it('should use provided end time for exited sessions', () => {
    const startTime = new Date('2024-01-01T10:00:00Z');
    const endTime = new Date('2024-01-01T10:30:45Z'); // 30m 45s later

    expect(formatSessionDuration(startTime.toISOString(), endTime.toISOString())).toBe('30m 45s');
  });

  it('should calculate duration between start and end times correctly', () => {
    const startTime = new Date('2024-01-01T00:00:00Z');
    const endTime = new Date('2024-01-01T02:15:30Z'); // 2h 15m 30s later

    expect(formatSessionDuration(startTime.toISOString(), endTime.toISOString())).toBe('2h 15m');
  });

  it('should handle same start and end time', () => {
    const time = new Date().toISOString();
    expect(formatSessionDuration(time, time)).toBe('0s');
  });

  it('should handle invalid dates gracefully', () => {
    expect(formatSessionDuration('invalid-date')).toBe('0s');
    expect(formatSessionDuration('')).toBe('0s');
  });

  it('should ignore end time if it is before start time', () => {
    const startTime = new Date('2024-01-01T10:00:00Z');
    const endTime = new Date('2024-01-01T09:00:00Z'); // 1 hour before start

    // Should calculate from start to now instead
    const result = formatSessionDuration(startTime.toISOString(), endTime.toISOString());
    // Result will be based on current time, so we just check it's not negative
    expect(result).toMatch(/^\d+[dhms]/);
  });
});
