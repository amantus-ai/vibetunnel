import { describe, expect, it } from 'vitest';
import { copyToClipboard, formatPathForDisplay } from './path-utils.js';

describe('formatPathForDisplay', () => {
  describe('macOS paths', () => {
    it('should replace /Users/username with ~', () => {
      expect(formatPathForDisplay('/Users/john/Documents/project')).toBe('~/Documents/project');
      expect(formatPathForDisplay('/Users/alice/Downloads')).toBe('~/Downloads');
      expect(formatPathForDisplay('/Users/bob')).toBe('~');
    });

    it('should handle usernames with special characters', () => {
      expect(formatPathForDisplay('/Users/john.doe/Documents')).toBe('~/Documents');
      expect(formatPathForDisplay('/Users/alice-smith/Projects')).toBe('~/Projects');
      expect(formatPathForDisplay('/Users/user123/Desktop')).toBe('~/Desktop');
    });

    it('should not replace if not at the beginning', () => {
      expect(formatPathForDisplay('/var/log/Users/john')).toBe('/var/log/Users/john');
    });
  });

  describe('Linux paths', () => {
    it('should replace /home/username with ~', () => {
      expect(formatPathForDisplay('/home/john/Documents/project')).toBe('~/Documents/project');
      expect(formatPathForDisplay('/home/alice/Downloads')).toBe('~/Downloads');
      expect(formatPathForDisplay('/home/bob')).toBe('~');
    });

    it('should handle usernames with special characters', () => {
      expect(formatPathForDisplay('/home/john.doe/Documents')).toBe('~/Documents');
      expect(formatPathForDisplay('/home/alice-smith/Projects')).toBe('~/Projects');
      expect(formatPathForDisplay('/home/user123/Desktop')).toBe('~/Desktop');
    });

    it('should not replace if not at the beginning', () => {
      expect(formatPathForDisplay('/var/home/john')).toBe('/var/home/john');
    });
  });

  describe('Windows paths', () => {
    it('should replace C:\\Users\\username with ~ (backslashes)', () => {
      expect(formatPathForDisplay('C:\\Users\\john\\Documents\\project')).toBe(
        '~\\Documents\\project'
      );
      expect(formatPathForDisplay('C:\\Users\\alice\\Downloads')).toBe('~\\Downloads');
      expect(formatPathForDisplay('C:\\Users\\bob')).toBe('~');
    });

    it('should replace C:/Users/username with ~ (forward slashes)', () => {
      expect(formatPathForDisplay('C:/Users/john/Documents/project')).toBe('~/Documents/project');
      expect(formatPathForDisplay('C:/Users/alice/Downloads')).toBe('~/Downloads');
      expect(formatPathForDisplay('C:/Users/bob')).toBe('~');
    });

    it('should handle case-insensitive drive letters', () => {
      expect(formatPathForDisplay('c:\\Users\\john\\Documents')).toBe('~\\Documents');
      expect(formatPathForDisplay('c:/Users/alice/Downloads')).toBe('~/Downloads');
      expect(formatPathForDisplay('C:\\Users\\bob')).toBe('~');
      expect(formatPathForDisplay('c:\\Users\\jane')).toBe('~');
    });

    it('should handle mixed path separators', () => {
      expect(formatPathForDisplay('C:/Users/john\\Documents')).toBe('~\\Documents');
      expect(formatPathForDisplay('c:\\Users/alice/Downloads')).toBe('~/Downloads');
    });

    it('should handle usernames with special characters', () => {
      expect(formatPathForDisplay('C:\\Users\\john.doe\\Documents')).toBe('~\\Documents');
      expect(formatPathForDisplay('C:/Users/alice-smith/Projects')).toBe('~/Projects');
      expect(formatPathForDisplay('c:\\Users\\user123\\Desktop')).toBe('~\\Desktop');
      expect(formatPathForDisplay('c:/Users/test_user/Files')).toBe('~/Files');
    });

    it('should not replace if not C: drive', () => {
      expect(formatPathForDisplay('D:\\Users\\john')).toBe('D:\\Users\\john');
      expect(formatPathForDisplay('d:/Users/alice')).toBe('d:/Users/alice');
      expect(formatPathForDisplay('E:\\Users\\bob')).toBe('E:\\Users\\bob');
    });

    it('should not replace if Users is not after drive', () => {
      expect(formatPathForDisplay('C:\\Program Files\\Users\\app')).toBe(
        'C:\\Program Files\\Users\\app'
      );
      expect(formatPathForDisplay('C:/Documents/Users/file')).toBe('C:/Documents/Users/file');
    });
  });

  describe('Root user paths', () => {
    it('should replace /root with ~', () => {
      expect(formatPathForDisplay('/root')).toBe('~');
      expect(formatPathForDisplay('/root/Documents')).toBe('~/Documents');
      expect(formatPathForDisplay('/root/.config/app')).toBe('~/.config/app');
    });

    it('should not replace if not at the beginning', () => {
      expect(formatPathForDisplay('/var/root')).toBe('/var/root');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty string', () => {
      expect(formatPathForDisplay('')).toBe('');
    });

    it('should handle null/undefined gracefully', () => {
      // Test with intentionally wrong types to ensure graceful handling
      // @ts-expect-error Testing null input
      expect(formatPathForDisplay(null)).toBe('');
      // @ts-expect-error Testing undefined input
      expect(formatPathForDisplay(undefined)).toBe('');
    });

    it('should handle paths that do not match any pattern', () => {
      expect(formatPathForDisplay('/var/log/messages')).toBe('/var/log/messages');
      expect(formatPathForDisplay('/etc/config')).toBe('/etc/config');
      expect(formatPathForDisplay('relative/path')).toBe('relative/path');
    });

    it('should handle already formatted paths', () => {
      expect(formatPathForDisplay('~/Documents')).toBe('~/Documents');
      expect(formatPathForDisplay('~')).toBe('~');
    });

    it('should apply only the first matching pattern', () => {
      // This tests that the replacements are not cumulative
      expect(formatPathForDisplay('/Users/test/home/another/Users/path')).toBe(
        '~/home/another/Users/path'
      );
      expect(formatPathForDisplay('/home/user1/projects/home/user2')).toBe('~/projects/home/user2');
      expect(formatPathForDisplay('C:\\Users\\john\\Users\\data')).toBe('~\\Users\\data');
    });

    it('should handle multiple home directory patterns in path', () => {
      // Ensure only the first match is replaced
      expect(formatPathForDisplay('/home/alice/work/home/bob/files')).toBe('~/work/home/bob/files');
      expect(formatPathForDisplay('/Users/john/backup/Users/jane')).toBe('~/backup/Users/jane');
      expect(formatPathForDisplay('C:/Users/admin/home/user')).toBe('~/home/user');
    });
  });
});

describe('copyToClipboard', () => {
  // Note: These tests would require mocking navigator.clipboard
  // which is better handled in a browser environment or with proper mocks
  it('should be a function', () => {
    expect(typeof copyToClipboard).toBe('function');
  });
});
