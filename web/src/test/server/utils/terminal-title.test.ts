import { describe, expect, it } from 'vitest';
import type { ActivityState } from '../../../server/utils/activity-detector.js';
import {
  filterTerminalTitleSequences,
  generateDynamicTitle,
  generateStaticTitle,
  generateTitleSequence,
  injectTitleIfNeeded,
} from '../../../server/utils/terminal-title.js';

describe('Terminal Title', () => {
  describe('generateStaticTitle', () => {
    it('should generate static title with path and command', () => {
      const title = generateStaticTitle('/home/user/project', ['node', 'server.js']);
      expect(title).toBe('~/project · node server.js');
    });

    it('should use session name if provided', () => {
      const title = generateStaticTitle('/home/user/project', ['node', 'server.js'], 'My Server');
      expect(title).toBe('~/project · My Server');
    });

    it('should handle home directory replacement', () => {
      const homeDir = process.env.HOME || '/home/user';
      const title = generateStaticTitle(`${homeDir}/projects/app`, ['npm', 'start']);
      expect(title).toBe('~/projects/app · npm start');
    });

    it('should truncate long commands', () => {
      const longCommand = Array(50).fill('arg').join(' ');
      const title = generateStaticTitle('/path', ['cmd', ...longCommand.split(' ')]);
      expect(title.length).toBeLessThanOrEqual(100);
      expect(title).toContain('…');
    });
  });

  describe('generateDynamicTitle', () => {
    it('should include Claude status when active', () => {
      const activity: ActivityState = {
        isActive: true,
        specificStatus: {
          app: 'claude',
          status: '✻ Thinking… (5s · ↑ 1.2k tokens · Ctrl+C to interrupt)',
        },
      };
      const title = generateDynamicTitle('/home/user', ['claude'], activity);
      expect(title).toBe('✻ Thinking… (5s · ↑ 1.2k tokens · Ctrl+C to interrupt) · ~ · claude');
    });

    it('should show active indicator when active but no specific status', () => {
      const activity: ActivityState = {
        isActive: true,
      };
      const title = generateDynamicTitle('/home/user', ['vim'], activity);
      expect(title).toBe('● · ~ · vim');
    });

    it('should show no indicator when idle', () => {
      const activity: ActivityState = {
        isActive: false,
      };
      const title = generateDynamicTitle('/home/user', ['vim'], activity);
      expect(title).toBe('~ · vim');
    });

    it('should truncate long Claude status', () => {
      const longStatus = `✻ ${'A'.repeat(200)}… (999s)`;
      const activity: ActivityState = {
        isActive: true,
        specificStatus: {
          app: 'claude',
          status: longStatus,
        },
      };
      const title = generateDynamicTitle('/path', ['claude'], activity);
      expect(title.length).toBeLessThanOrEqual(150);
      expect(title).toContain('…');
    });

    it('should handle missing directory gracefully', () => {
      const activity: ActivityState = { isActive: false };
      const title = generateDynamicTitle('', ['cmd'], activity);
      expect(title).toBe('/ · cmd');
    });
  });

  describe('generateTitleSequence', () => {
    it('should generate OSC 2 sequence with BEL terminator', () => {
      const sequence = generateTitleSequence('My Title');
      expect(sequence).toBe('\x1B]2;My Title\x07');
    });

    it('should handle empty title', () => {
      const sequence = generateTitleSequence('');
      expect(sequence).toBe('\x1B]2;\x07');
    });

    it('should escape special characters in title', () => {
      const sequence = generateTitleSequence('Title\nWith\rSpecial\x07Chars');
      expect(sequence).toBe('\x1B]2;Title With Special Chars\x07');
    });
  });

  describe('filterTerminalTitleSequences', () => {
    it('should filter OSC 0, 1, and 2 sequences', () => {
      const data = 'Before\x1B]0;Title0\x07Middle\x1B]1;Title1\x07After\x1B]2;Title2\x07End';
      const filtered = filterTerminalTitleSequences(data, true);
      expect(filtered).toBe('BeforeMiddleAfterEnd');
    });

    it('should handle ESC \\ terminator', () => {
      const data = 'Start\x1B]2;My Title\x1B\\End';
      const filtered = filterTerminalTitleSequences(data, true);
      expect(filtered).toBe('StartEnd');
    });

    it('should preserve data when filterTitles is false', () => {
      const data = 'Data\x1B]2;Title\x07More';
      const filtered = filterTerminalTitleSequences(data, false);
      expect(filtered).toBe(data);
    });

    it('should handle multiple sequences in one pass', () => {
      const data = '\x1B]0;Title1\x07\x1B]2;Title2\x07Content\x1B]1;Title3\x07';
      const filtered = filterTerminalTitleSequences(data, true);
      expect(filtered).toBe('Content');
    });

    it('should not filter other escape sequences', () => {
      const data = '\x1B[31mRed Text\x1B[0m\x1B]2;Title\x07Normal';
      const filtered = filterTerminalTitleSequences(data, true);
      expect(filtered).toBe('\x1B[31mRed Text\x1B[0mNormal');
    });
  });

  describe('injectTitleIfNeeded', () => {
    it('should inject title at safe position after complete sequence', () => {
      const data = 'Output\x1B[0m\nMore output';
      const title = '\x1B]2;New Title\x07';
      const result = injectTitleIfNeeded(data, title);
      expect(result).toBe('Output\x1B[0m\x1B]2;New Title\x07\nMore output');
    });

    it('should inject at newline when no escape sequence', () => {
      const data = 'Line 1\nLine 2\nLine 3';
      const title = '\x1B]2;Title\x07';
      const result = injectTitleIfNeeded(data, title);
      expect(result).toBe('Line 1\n\x1B]2;Title\x07Line 2\nLine 3');
    });

    it('should append title when no safe injection point', () => {
      const data = 'Continuous output without breaks';
      const title = '\x1B]2;Title\x07';
      const result = injectTitleIfNeeded(data, title);
      expect(result).toBe('Continuous output without breaks\x1B]2;Title\x07');
    });

    it('should handle empty data', () => {
      const data = '';
      const title = '\x1B]2;Title\x07';
      const result = injectTitleIfNeeded(data, title);
      expect(result).toBe('\x1B]2;Title\x07');
    });

    it('should not inject duplicate titles', () => {
      const data = 'Output\x1B]2;Title\x07More';
      const title = '\x1B]2;Title\x07';
      const result = injectTitleIfNeeded(data, title);
      expect(result).toBe(data); // No change
    });
  });

  describe('Edge cases', () => {
    it('should handle very long paths', () => {
      const longPath = `/${Array(50).fill('directory').join('/')}`;
      const title = generateStaticTitle(longPath, ['cmd']);
      expect(title.length).toBeLessThanOrEqual(100);
    });

    it('should handle commands with special characters', () => {
      const title = generateStaticTitle('/path', ['cmd', '--option="value with spaces"']);
      expect(title).toContain('cmd --option="value with spaces"');
    });

    it('should handle null/undefined gracefully', () => {
      const title = generateDynamicTitle('/path', ['cmd'], {
        isActive: true,
        specificStatus: undefined,
      });
      expect(title).toBe('● · /path · cmd');
    });
  });
});
