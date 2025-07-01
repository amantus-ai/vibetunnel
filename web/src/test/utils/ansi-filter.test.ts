import { beforeEach, describe, expect, it } from 'vitest';
import { AnsiFilter } from '../../server/utils/ansi-filter.js';

describe('ANSI Filter Utilities', () => {
  describe('AnsiFilter', () => {
    let filter: AnsiFilter;

    beforeEach(() => {
      filter = new AnsiFilter();
    });

    describe('filter method', () => {
      it('should return data unchanged when filtering is disabled', () => {
        const data = '\x1B]2;Test Title\x07Hello World';
        expect(filter.filter(data, false)).toBe(data);
      });

      it('should filter OSC 0 sequences (icon and window title)', () => {
        const input = '\x1B]0;Icon and Window\x07Hello World';
        const expected = 'Hello World';
        expect(filter.filter(input, true)).toBe(expected);
      });

      it('should filter OSC 1 sequences (icon title)', () => {
        const input = '\x1B]1;Icon Title\x07Hello World';
        const expected = 'Hello World';
        expect(filter.filter(input, true)).toBe(expected);
      });

      it('should filter OSC 2 sequences (window title)', () => {
        const input = '\x1B]2;Window Title\x07Hello World';
        const expected = 'Hello World';
        expect(filter.filter(input, true)).toBe(expected);
      });

      it('should filter sequences ending with ESC \\ instead of BEL', () => {
        const input = '\x1B]2;Window Title\x1B\\Hello World';
        const expected = 'Hello World';
        expect(filter.filter(input, true)).toBe(expected);
      });

      it('should filter multiple title sequences in one string', () => {
        const input = '\x1B]2;Title 1\x07Some text\x1B]0;Title 2\x07More text';
        const expected = 'Some textMore text';
        expect(filter.filter(input, true)).toBe(expected);
      });

      it('should preserve other ANSI sequences', () => {
        const input = '\x1B[31mRed Text\x1B[0m\x1B]2;Title\x07Normal';
        const expected = '\x1B[31mRed Text\x1B[0mNormal';
        expect(filter.filter(input, true)).toBe(expected);
      });

      it('should handle empty strings', () => {
        expect(filter.filter('', true)).toBe('');
      });

      it('should handle strings with only title sequences', () => {
        const input = '\x1B]2;Title\x07';
        expect(filter.filter(input, true)).toBe('');
      });

      it('should handle malformed sequences gracefully', () => {
        const input = '\x1B]2;Incomplete';
        expect(filter.filter(input, true)).toBe(input);
      });

      // Test stateful behavior - sequences split across chunks
      it('should handle title sequences split across chunks', () => {
        // First chunk ends in the middle of a title sequence
        const chunk1 = 'Hello \x1B]2;My Ti';
        const chunk2 = 'tle\x07 World';

        const result1 = filter.filter(chunk1, true);
        const result2 = filter.filter(chunk2, true);

        expect(result1).toBe('Hello ');
        expect(result2).toBe(' World');
      });

      it('should handle escape character at chunk boundary', () => {
        const chunk1 = 'Text \x1B';
        const chunk2 = ']2;Title\x07 More';

        const result1 = filter.filter(chunk1, true);
        const result2 = filter.filter(chunk2, true);

        expect(result1).toBe('Text ');
        expect(result2).toBe(' More');
      });

      it('should handle ST terminator split across chunks', () => {
        const chunk1 = 'Before \x1B]2;Title\x1B';
        const chunk2 = '\\ After';

        const result1 = filter.filter(chunk1, true);
        const result2 = filter.filter(chunk2, true);

        expect(result1).toBe('Before ');
        expect(result2).toBe(' After');
      });

      it('should preserve state across multiple calls', () => {
        // Send title sequence in multiple small chunks
        const chunks = ['Start ', '\x1B', ']', '2', ';', 'My', ' Title', '\x07', ' End'];

        const results = chunks.map((chunk) => filter.filter(chunk, true));
        const combined = results.join('');

        expect(combined).toBe('Start  End');
      });

      it('should reset state after complete sequence', () => {
        // First sequence
        filter.filter('\x1B]2;Title1\x07', true);

        // Second sequence should work independently
        const result = filter.filter('\x1B]2;Title2\x07Text', true);
        expect(result).toBe('Text');
      });
    });

    describe('filterBuffer method', () => {
      it('should return buffer unchanged when filtering is disabled', () => {
        const data = '\x1B]2;Test Title\x07Hello World';
        const buffer = Buffer.from(data, 'utf8');
        const result = filter.filterBuffer(buffer, false);
        expect(result).toBe(buffer);
        expect(result.toString()).toBe(data);
      });

      it('should filter title sequences from buffer', () => {
        const input = '\x1B]2;Test Title\x07Hello World';
        const buffer = Buffer.from(input, 'utf8');
        const result = filter.filterBuffer(buffer, true);
        expect(result.toString()).toBe('Hello World');
      });

      it('should return same buffer object if nothing was filtered', () => {
        const input = 'Hello World';
        const buffer = Buffer.from(input, 'utf8');
        const result = filter.filterBuffer(buffer, true);
        expect(result).toBe(buffer); // Same object reference
      });

      it('should create new buffer only when content changes', () => {
        const input = '\x1B]2;Title\x07Hello';
        const buffer = Buffer.from(input, 'utf8');
        const result = filter.filterBuffer(buffer, true);
        expect(result).not.toBe(buffer); // Different object
        expect(result.toString()).toBe('Hello');
      });

      it('should handle UTF-8 correctly', () => {
        const input = '\x1B]2;Title\x07Hello 世界 🌍';
        const buffer = Buffer.from(input, 'utf8');
        const result = filter.filterBuffer(buffer, true);
        expect(result.toString()).toBe('Hello 世界 🌍');
      });

      it('should maintain state across buffer calls', () => {
        // Split sequence across buffers
        const buffer1 = Buffer.from('Text \x1B]2;Ti', 'utf8');
        const buffer2 = Buffer.from('tle\x07 More', 'utf8');

        const result1 = filter.filterBuffer(buffer1, true);
        const result2 = filter.filterBuffer(buffer2, true);

        expect(result1.toString()).toBe('Text ');
        expect(result2.toString()).toBe(' More');
      });
    });

    describe('reset method', () => {
      it('should clear all internal state', () => {
        // Start a sequence
        filter.filter('Hello \x1B]2;Incomp', true);

        // Reset
        filter.reset();

        // The incomplete sequence should be output as-is now
        const result = filter.filter('lete\x07 World', true);
        expect(result).toBe('lete\x07 World');
      });
    });
  });
});
