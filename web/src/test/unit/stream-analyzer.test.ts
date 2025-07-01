import { beforeEach, describe, expect, it } from 'vitest';
import { PTYStreamAnalyzer } from '../../server/pty/stream-analyzer.js';

describe('PTYStreamAnalyzer', () => {
  let analyzer: PTYStreamAnalyzer;

  beforeEach(() => {
    analyzer = new PTYStreamAnalyzer();
  });

  describe('newline detection', () => {
    it('should detect newline as safe injection point', () => {
      const buffer = Buffer.from('Hello World\n');
      const points = analyzer.process(buffer);

      expect(points).toHaveLength(1);
      expect(points[0]).toEqual({
        position: 12, // After newline
        reason: 'newline',
        confidence: 100,
      });
    });

    it('should detect multiple newlines', () => {
      const buffer = Buffer.from('Line 1\nLine 2\nLine 3\n');
      const points = analyzer.process(buffer);

      expect(points).toHaveLength(3);
      expect(points.map((p) => p.position)).toEqual([7, 14, 21]);
      expect(points.every((p) => p.reason === 'newline')).toBe(true);
    });
  });

  describe('carriage return detection', () => {
    it('should detect carriage return as safe injection point', () => {
      const buffer = Buffer.from('Progress: 100%\r');
      const points = analyzer.process(buffer);

      expect(points).toHaveLength(1);
      expect(points[0]).toEqual({
        position: 15, // After \r
        reason: 'carriage_return',
        confidence: 90,
      });
    });

    it('should handle CRLF', () => {
      const buffer = Buffer.from('Windows line\r\n');
      const points = analyzer.process(buffer);

      expect(points).toHaveLength(2);
      expect(points[0].reason).toBe('carriage_return');
      expect(points[1].reason).toBe('newline');
    });
  });

  describe('ANSI escape sequence detection', () => {
    it('should detect end of CSI color sequence', () => {
      const buffer = Buffer.from('\x1b[31mRed\x1b[0m');
      const points = analyzer.process(buffer);

      expect(points).toHaveLength(2);
      expect(points[0]).toEqual({
        position: 5, // After \x1b[31m
        reason: 'sequence_end',
        confidence: 80,
      });
      expect(points[1]).toEqual({
        position: 12, // After \x1b[0m
        reason: 'sequence_end',
        confidence: 80,
      });
    });

    it('should handle cursor movement sequences', () => {
      const buffer = Buffer.from('\x1b[2A\x1b[3B');
      const points = analyzer.process(buffer);

      expect(points).toHaveLength(2);
      expect(points.every((p) => p.reason === 'sequence_end')).toBe(true);
    });

    it('should handle complex CSI sequences', () => {
      const buffer = Buffer.from('\x1b[38;5;196m'); // 256 color
      const points = analyzer.process(buffer);

      expect(points).toHaveLength(1);
      expect(points[0].position).toBe(11);
    });

    it('should not inject in middle of escape sequence', () => {
      const buffer1 = Buffer.from('\x1b[31');
      const points1 = analyzer.process(buffer1);
      expect(points1).toHaveLength(0);

      const buffer2 = Buffer.from('m');
      const points2 = analyzer.process(buffer2);
      expect(points2).toHaveLength(1);
      expect(points2[0].position).toBe(1);
    });
  });

  describe('OSC sequence detection', () => {
    it('should detect end of OSC title sequence', () => {
      const buffer = Buffer.from('\x1b]0;Terminal Title\x07');
      const points = analyzer.process(buffer);

      expect(points).toHaveLength(1);
      expect(points[0]).toEqual({
        position: 19, // After BEL
        reason: 'sequence_end',
        confidence: 80,
      });
    });

    it('should handle OSC with ST terminator', () => {
      const buffer = Buffer.from('\x1b]0;Title\x1b\\');
      const points = analyzer.process(buffer);

      expect(points).toHaveLength(1);
      expect(points[0].position).toBe(11); // After ESC\
    });
  });

  describe('prompt pattern detection', () => {
    it('should detect bash prompt', () => {
      const buffer = Buffer.from('user@host:~$ ');
      const points = analyzer.process(buffer);

      expect(points).toHaveLength(1);
      expect(points[0]).toEqual({
        position: 13,
        reason: 'prompt',
        confidence: 85,
      });
    });

    it('should detect root prompt', () => {
      const buffer = Buffer.from('root@server:/# ');
      const points = analyzer.process(buffer);

      expect(points).toHaveLength(1);
      expect(points[0].reason).toBe('prompt');
    });

    it('should detect fish prompt', () => {
      const buffer = Buffer.from('~/projects> ');
      const points = analyzer.process(buffer);

      expect(points).toHaveLength(1);
      expect(points[0].reason).toBe('prompt');
    });

    it('should detect modern prompt', () => {
      const buffer = Buffer.from('~/code ❯ ');
      const points = analyzer.process(buffer);

      expect(points).toHaveLength(1);
      expect(points[0].reason).toBe('prompt');
    });

    it('should detect Python REPL prompt', () => {
      const _buffer = Buffer.from('>>> ');
      analyzer.process(Buffer.from('>>'));
      const points = analyzer.process(Buffer.from('> '));

      expect(points).toHaveLength(1);
      expect(points[0].reason).toBe('prompt');
    });
  });

  describe('UTF-8 handling', () => {
    it('should not inject in middle of 2-byte UTF-8', () => {
      // € symbol: C2 A2
      const buffer1 = Buffer.from([0xc2]);
      const points1 = analyzer.process(buffer1);
      expect(points1).toHaveLength(0);

      const buffer2 = Buffer.from([0xa2, 0x0a]); // Complete char + newline
      const points2 = analyzer.process(buffer2);
      expect(points2).toHaveLength(1);
      expect(points2[0].position).toBe(2); // After newline
    });

    it('should not inject in middle of 3-byte UTF-8', () => {
      // ∑ symbol: E2 88 91
      const buffer = Buffer.from([0xe2, 0x88]);
      const points = analyzer.process(buffer);
      expect(points).toHaveLength(0);
    });

    it('should not inject in middle of 4-byte UTF-8', () => {
      // 😀 emoji: F0 9F 98 80
      const buffer = Buffer.from([0xf0, 0x9f, 0x98]);
      const points = analyzer.process(buffer);
      expect(points).toHaveLength(0);
    });

    it('should handle complete UTF-8 sequences', () => {
      const buffer = Buffer.from('Hello 世界\n');
      const points = analyzer.process(buffer);

      expect(points).toHaveLength(1);
      expect(points[0].reason).toBe('newline');
    });
  });

  describe('state management', () => {
    it('should maintain state across multiple process calls', () => {
      // Split escape sequence across buffers
      const buffer1 = Buffer.from('\x1b[');
      const points1 = analyzer.process(buffer1);
      expect(points1).toHaveLength(0);

      const buffer2 = Buffer.from('31m');
      const points2 = analyzer.process(buffer2);
      expect(points2).toHaveLength(1);
    });

    it('should reset state correctly', () => {
      // Process partial sequence
      analyzer.process(Buffer.from('\x1b[31'));

      // Reset
      analyzer.reset();

      // Should treat new ESC as start of sequence
      const points = analyzer.process(Buffer.from('\x1b[0m'));
      expect(points).toHaveLength(1);
    });

    it('should provide state information', () => {
      const state1 = analyzer.getState();
      expect(state1.inEscape).toBe(false);

      analyzer.process(Buffer.from('\x1b['));
      const state2 = analyzer.getState();
      expect(state2.inEscape).toBe(true);
    });
  });

  describe('complex scenarios', () => {
    it('should handle mixed content', () => {
      const buffer = Buffer.from('Normal text\n\x1b[32mGreen\x1b[0m\rProgress\n$ ');
      const points = analyzer.process(buffer);

      expect(points.length).toBeGreaterThan(0);
      const reasons = points.map((p) => p.reason);
      expect(reasons).toContain('newline');
      expect(reasons).toContain('sequence_end');
      expect(reasons).toContain('carriage_return');
      expect(reasons).toContain('prompt');
    });

    it('should handle rapid color changes', () => {
      const buffer = Buffer.from('\x1b[31mR\x1b[32mG\x1b[34mB\x1b[0m');
      const points = analyzer.process(buffer);

      expect(points).toHaveLength(4); // After each sequence
      expect(points.every((p) => p.reason === 'sequence_end')).toBe(true);
    });

    it('should handle real terminal output', () => {
      // Simulating 'ls --color' output
      const buffer = Buffer.from(
        '\x1b[0m\x1b[01;34mdir1\x1b[0m\n' + '\x1b[01;32mexecutable\x1b[0m\n' + 'file.txt\n'
      );
      const points = analyzer.process(buffer);

      const newlines = points.filter((p) => p.reason === 'newline');
      expect(newlines).toHaveLength(3);
    });
  });
});
