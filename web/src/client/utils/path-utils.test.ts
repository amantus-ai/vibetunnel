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
    it('should replace C:\\Users\\username with ~', () => {
      expect(formatPathForDisplay('C:\\Users\\john\\Documents\\project')).toBe(
        '~\\Documents\\project'
      );
      expect(formatPathForDisplay('C:\\Users\\alice\\Downloads')).toBe('~\\Downloads');
      expect(formatPathForDisplay('C:\\Users\\bob')).toBe('~');
    });

    it('should handle usernames with special characters', () => {
      expect(formatPathForDisplay('C:\\Users\\john.doe\\Documents')).toBe('~\\Documents');
      expect(formatPathForDisplay('C:\\Users\\alice-smith\\Projects')).toBe('~\\Projects');
      expect(formatPathForDisplay('C:\\Users\\user123\\Desktop')).toBe('~\\Desktop');
    });

    it('should not replace if not C: drive', () => {
      expect(formatPathForDisplay('D:\\Users\\john')).toBe('D:\\Users\\john');
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
      const testPath = '/Users/test/home/another/Users/path';
      expect(formatPathForDisplay(testPath)).toBe('~/home/another/Users/path');
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
