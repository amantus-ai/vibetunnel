import { describe, expect, it } from 'vitest';
import {
  filterTerminalTitleSequences,
  filterTerminalTitleSequencesBuffer,
} from '../../server/utils/ansi-filter.js';

describe('ANSI Filter Utilities', () => {
  describe('filterTerminalTitleSequences', () => {
    it('should return data unchanged when filtering is disabled', () => {
      const data = '\x1B]2;Test Title\x07Hello World';
      expect(filterTerminalTitleSequences(data, false)).toBe(data);
    });

    it('should filter OSC 0 sequences (icon and window title)', () => {
      const input = '\x1B]0;Icon and Window\x07Hello World';
      const expected = 'Hello World';
      expect(filterTerminalTitleSequences(input, true)).toBe(expected);
    });

    it('should filter OSC 1 sequences (icon title)', () => {
      const input = '\x1B]1;Icon Title\x07Hello World';
      const expected = 'Hello World';
      expect(filterTerminalTitleSequences(input, true)).toBe(expected);
    });

    it('should filter OSC 2 sequences (window title)', () => {
      const input = '\x1B]2;Window Title\x07Hello World';
      const expected = 'Hello World';
      expect(filterTerminalTitleSequences(input, true)).toBe(expected);
    });

    it('should filter sequences ending with ESC \\ instead of BEL', () => {
      const input = '\x1B]2;Window Title\x1B\\Hello World';
      const expected = 'Hello World';
      expect(filterTerminalTitleSequences(input, true)).toBe(expected);
    });

    it('should filter multiple title sequences in one string', () => {
      const input = '\x1B]2;Title 1\x07Some text\x1B]0;Title 2\x07More text';
      const expected = 'Some textMore text';
      expect(filterTerminalTitleSequences(input, true)).toBe(expected);
    });

    it('should preserve other ANSI sequences', () => {
      const input = '\x1B[31mRed Text\x1B[0m\x1B]2;Title\x07Normal';
      const expected = '\x1B[31mRed Text\x1B[0mNormal';
      expect(filterTerminalTitleSequences(input, true)).toBe(expected);
    });

    it('should handle empty strings', () => {
      expect(filterTerminalTitleSequences('', true)).toBe('');
    });

    it('should handle strings with only title sequences', () => {
      const input = '\x1B]2;Title\x07';
      expect(filterTerminalTitleSequences(input, true)).toBe('');
    });

    it('should handle malformed sequences gracefully', () => {
      const input = '\x1B]2;Incomplete';
      expect(filterTerminalTitleSequences(input, true)).toBe(input);
    });
  });

  describe('filterTerminalTitleSequencesBuffer', () => {
    it('should return buffer unchanged when filtering is disabled', () => {
      const data = '\x1B]2;Test Title\x07Hello World';
      const buffer = Buffer.from(data, 'utf8');
      const result = filterTerminalTitleSequencesBuffer(buffer, false);
      expect(result).toBe(buffer);
      expect(result.toString()).toBe(data);
    });

    it('should filter title sequences from buffer', () => {
      const input = '\x1B]2;Test Title\x07Hello World';
      const buffer = Buffer.from(input, 'utf8');
      const result = filterTerminalTitleSequencesBuffer(buffer, true);
      expect(result.toString()).toBe('Hello World');
    });

    it('should return same buffer object if nothing was filtered', () => {
      const input = 'Hello World';
      const buffer = Buffer.from(input, 'utf8');
      const result = filterTerminalTitleSequencesBuffer(buffer, true);
      expect(result).toBe(buffer); // Same object reference
    });

    it('should create new buffer only when content changes', () => {
      const input = '\x1B]2;Title\x07Hello';
      const buffer = Buffer.from(input, 'utf8');
      const result = filterTerminalTitleSequencesBuffer(buffer, true);
      expect(result).not.toBe(buffer); // Different object
      expect(result.toString()).toBe('Hello');
    });

    it('should handle UTF-8 correctly', () => {
      const input = '\x1B]2;Title\x07Hello 世界 🌍';
      const buffer = Buffer.from(input, 'utf8');
      const result = filterTerminalTitleSequencesBuffer(buffer, true);
      expect(result.toString()).toBe('Hello 世界 🌍');
    });
  });
});
