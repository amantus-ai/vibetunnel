import { beforeEach, describe, expect, it } from 'vitest';
import { TitleSequenceFilter } from '../../server/utils/ansi-title-filter.js';

describe('ANSI Title Filter', () => {
  describe('TitleSequenceFilter', () => {
    let filter: TitleSequenceFilter;

    beforeEach(() => {
      filter = new TitleSequenceFilter();
    });

    describe('filter method', () => {
      it('should filter OSC 0 sequences (icon and window title)', () => {
        const input = '\x1B]0;Icon and Window\x07Hello World';
        const expected = 'Hello World';
        expect(filter.filter(input)).toBe(expected);
      });

      it('should filter OSC 1 sequences (icon title)', () => {
        const input = '\x1B]1;Icon Title\x07Hello World';
        const expected = 'Hello World';
        expect(filter.filter(input)).toBe(expected);
      });

      it('should filter OSC 2 sequences (window title)', () => {
        const input = '\x1B]2;Window Title\x07Hello World';
        const expected = 'Hello World';
        expect(filter.filter(input)).toBe(expected);
      });

      it('should filter sequences ending with ESC \\ instead of BEL', () => {
        const input = '\x1B]2;Window Title\x1B\\Hello World';
        const expected = 'Hello World';
        expect(filter.filter(input)).toBe(expected);
      });

      it('should filter multiple title sequences in one string', () => {
        const input = '\x1B]2;Title 1\x07Some text\x1B]0;Title 2\x07More text';
        const expected = 'Some textMore text';
        expect(filter.filter(input)).toBe(expected);
      });

      it('should preserve other ANSI sequences', () => {
        const input = '\x1B[31mRed Text\x1B[0m\x1B]2;Title\x07Normal';
        const expected = '\x1B[31mRed Text\x1B[0mNormal';
        expect(filter.filter(input)).toBe(expected);
      });

      it('should handle empty strings', () => {
        expect(filter.filter('')).toBe('');
      });

      it('should handle strings with only title sequences', () => {
        const input = '\x1B]2;Title\x07';
        expect(filter.filter(input)).toBe('');
      });

      it('should preserve incomplete sequences at the end', () => {
        const input = '\x1B]2;Incomplete';
        const result = filter.filter(input);
        expect(result).toBe(''); // Incomplete sequence is buffered
      });

      it('should handle strings without any sequences', () => {
        const input = 'Hello World! No sequences here.';
        expect(filter.filter(input)).toBe(input);
      });

      it('should handle OSC sequences with empty titles', () => {
        const input = '\x1B]2;\x07Text';
        expect(filter.filter(input)).toBe('Text');
      });

      it('should handle title sequences with special characters', () => {
        const input = '\x1B]2;Title with \n newline and \t tab\x07Text';
        expect(filter.filter(input)).toBe('Text');
      });

      it('should handle title sequences with Unicode characters', () => {
        const input = '\x1B]2;世界 🌍 Title\x07Hello';
        expect(filter.filter(input)).toBe('Hello');
      });

      // Test stateful behavior - sequences split across chunks
      describe('split sequences across chunks', () => {
        it('should handle title sequences split across chunks', () => {
          // First chunk ends in the middle of a title sequence
          const chunk1 = 'Hello \x1B]2;My Ti';
          const chunk2 = 'tle\x07 World';

          const result1 = filter.filter(chunk1);
          const result2 = filter.filter(chunk2);

          expect(result1).toBe('Hello ');
          expect(result2).toBe(' World');
        });

        it('should handle escape character at chunk boundary', () => {
          const chunk1 = 'Text \x1B';
          const chunk2 = ']2;Title\x07 More';

          const result1 = filter.filter(chunk1);
          const result2 = filter.filter(chunk2);

          expect(result1).toBe('Text ');
          expect(result2).toBe(' More');
        });

        it('should handle OSC start split across chunks', () => {
          const chunk1 = 'Before \x1B]';
          const chunk2 = '2;Title\x07 After';

          const result1 = filter.filter(chunk1);
          const result2 = filter.filter(chunk2);

          expect(result1).toBe('Before ');
          expect(result2).toBe(' After');
        });

        it('should handle OSC number split across chunks', () => {
          const chunk1 = 'Before \x1B]2';
          const chunk2 = ';Title\x07 After';

          const result1 = filter.filter(chunk1);
          const result2 = filter.filter(chunk2);

          expect(result1).toBe('Before ');
          expect(result2).toBe(' After');
        });

        it('should handle ST terminator split across chunks', () => {
          const chunk1 = 'Before \x1B]2;Title\x1B';
          const chunk2 = '\\ After';

          const result1 = filter.filter(chunk1);
          const result2 = filter.filter(chunk2);

          expect(result1).toBe('Before ');
          expect(result2).toBe(' After');
        });

        it('should preserve state across multiple calls', () => {
          // Send title sequence in multiple small chunks
          const chunks = ['Start ', '\x1B', ']', '2', ';', 'My', ' Title', '\x07', ' End'];

          const results = chunks.map((chunk) => filter.filter(chunk));
          const combined = results.join('');

          expect(combined).toBe('Start  End');
        });

        it('should handle incomplete sequence followed by complete data', () => {
          const chunk1 = 'Text \x1B]2;Incomp';
          const chunk2 = 'lete Title\x07 More text';

          const result1 = filter.filter(chunk1);
          const result2 = filter.filter(chunk2);

          expect(result1).toBe('Text ');
          expect(result2).toBe(' More text');
        });

        it('should handle very long title sequences split across chunks', () => {
          const longTitle = 'A'.repeat(1000);
          const chunk1 = `Before \x1B]2;${longTitle.substring(0, 500)}`;
          const chunk2 = `${longTitle.substring(500)}\x07 After`;

          const result1 = filter.filter(chunk1);
          const result2 = filter.filter(chunk2);

          expect(result1).toBe('Before ');
          expect(result2).toBe(' After');
        });

        it('should handle non-title OSC sequences', () => {
          // OSC 3 is not a title sequence, should not be filtered
          const input = '\x1B]3;Some data\x07Text';
          expect(filter.filter(input)).toBe(input);
        });

        it('should buffer incomplete escape at end', () => {
          const chunk1 = 'Text \x1B';
          const chunk2 = '[31mRed\x1B[0m'; // Not a title sequence

          const result1 = filter.filter(chunk1);
          const result2 = filter.filter(chunk2);

          expect(result1).toBe('Text ');
          expect(result2).toBe('\x1B[31mRed\x1B[0m');
        });
      });

      describe('edge cases', () => {
        it('should handle OSC followed by non-title number', () => {
          const input = '\x1B]9;Not a title\x07Text';
          expect(filter.filter(input)).toBe(input); // Not filtered
        });

        it('should handle malformed OSC with no semicolon', () => {
          const input = '\x1B]2No semicolon\x07Text';
          expect(filter.filter(input)).toBe(input); // Not filtered
        });

        it('should handle title with BEL character inside', () => {
          // This is technically malformed but should be handled gracefully
          const input = '\x1B]2;Title with \x07 inside\x07Text';
          expect(filter.filter(input)).toBe(' inside\x07Text');
        });

        it('should handle title with ESC character inside', () => {
          // ESC inside a title breaks the title sequence pattern
          const input = '\x1B]2;Title with \x1B[31m inside\x07Text';
          // The title sequence is not properly terminated before the ESC, so it's not filtered
          expect(filter.filter(input)).toBe(input);
        });

        it('should handle consecutive title sequences', () => {
          const input = '\x1B]2;Title1\x07\x1B]2;Title2\x07\x1B]2;Title3\x07Text';
          expect(filter.filter(input)).toBe('Text');
        });
      });
    });
  });
});
