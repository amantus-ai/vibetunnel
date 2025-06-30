/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard, formatPathForDisplay } from './path-utils';

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
      expect(formatPathForDisplay('/Users/user_name/Files')).toBe('~/Files');
      expect(formatPathForDisplay('/Users/user@company/Work')).toBe('~/Work');
    });

    it('should handle usernames with regex special characters safely', () => {
      // Test usernames that contain regex special characters
      expect(formatPathForDisplay('/Users/user[test]/Documents')).toBe('~/Documents');
      expect(formatPathForDisplay('/Users/user(group)/Projects')).toBe('~/Projects');
      expect(formatPathForDisplay('/Users/user+plus/Desktop')).toBe('~/Desktop');
      expect(formatPathForDisplay('/Users/user$money/Files')).toBe('~/Files');
      expect(formatPathForDisplay('/Users/user.com/Work')).toBe('~/Work');
      expect(formatPathForDisplay('/Users/user*star/Downloads')).toBe('~/Downloads');
      expect(formatPathForDisplay('/Users/user?question/Apps')).toBe('~/Apps');
      expect(formatPathForDisplay('/Users/user^caret/Code')).toBe('~/Code');
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
      expect(formatPathForDisplay('/home/user_name/Files')).toBe('~/Files');
      expect(formatPathForDisplay('/home/user@company/Work')).toBe('~/Work');
    });

    it('should handle usernames with regex special characters safely', () => {
      // Test usernames that contain regex special characters
      expect(formatPathForDisplay('/home/user[test]/Documents')).toBe('~/Documents');
      expect(formatPathForDisplay('/home/user(group)/Projects')).toBe('~/Projects');
      expect(formatPathForDisplay('/home/user+plus/Desktop')).toBe('~/Desktop');
      expect(formatPathForDisplay('/home/user$money/Files')).toBe('~/Files');
      expect(formatPathForDisplay('/home/user.com/Work')).toBe('~/Work');
      expect(formatPathForDisplay('/home/user*star/Downloads')).toBe('~/Downloads');
      expect(formatPathForDisplay('/home/user?question/Apps')).toBe('~/Apps');
      expect(formatPathForDisplay('/home/user^caret/Code')).toBe('~/Code');
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
      expect(formatPathForDisplay('C:\\Users\\user@company\\Work')).toBe('~\\Work');
    });

    it('should handle usernames with regex special characters safely', () => {
      // Test usernames that contain regex special characters on Windows
      expect(formatPathForDisplay('C:\\Users\\user[test]\\Documents')).toBe('~\\Documents');
      expect(formatPathForDisplay('C:/Users/user(group)/Projects')).toBe('~/Projects');
      expect(formatPathForDisplay('c:\\Users\\user+plus\\Desktop')).toBe('~\\Desktop');
      expect(formatPathForDisplay('c:/Users/user$money/Files')).toBe('~/Files');
      expect(formatPathForDisplay('C:\\Users\\user.com\\Work')).toBe('~\\Work');
      expect(formatPathForDisplay('C:/Users/user*star/Downloads')).toBe('~/Downloads');
      expect(formatPathForDisplay('c:\\Users\\user?question\\Apps')).toBe('~\\Apps');
      expect(formatPathForDisplay('c:/Users/user^caret/Code')).toBe('~/Code');
    });

    it('should replace home directory for any Windows drive letter', () => {
      expect(formatPathForDisplay('D:\\Users\\john')).toBe('~');
      expect(formatPathForDisplay('d:/Users/alice')).toBe('~');
      expect(formatPathForDisplay('E:\\Users\\bob')).toBe('~');
      expect(formatPathForDisplay('Z:\\Users\\user\\Documents')).toBe('~\\Documents');
      expect(formatPathForDisplay('a:/Users/test/Desktop')).toBe('~/Desktop');
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
  let writeTextSpy: ReturnType<typeof vi.fn>;
  let execCommandSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset mocks
    writeTextSpy = vi.fn().mockResolvedValue(undefined);
    execCommandSpy = vi.fn().mockReturnValue(true);

    // Mock document.execCommand
    Object.defineProperty(document, 'execCommand', {
      value: execCommandSpy,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should use navigator.clipboard when available', async () => {
    // Mock navigator.clipboard
    vi.stubGlobal('navigator', { clipboard: { writeText: writeTextSpy } });

    const result = await copyToClipboard('test text');

    expect(writeTextSpy).toHaveBeenCalledWith('test text');
    expect(result).toBe(true);
    expect(execCommandSpy).not.toHaveBeenCalled();
  });

  it('should fallback to execCommand when clipboard API fails', async () => {
    // Mock navigator.clipboard to throw error
    writeTextSpy = vi.fn().mockRejectedValue(new Error('Clipboard API failed'));
    vi.stubGlobal('navigator', { clipboard: { writeText: writeTextSpy } });

    const result = await copyToClipboard('test text');

    expect(writeTextSpy).toHaveBeenCalledWith('test text');
    expect(execCommandSpy).toHaveBeenCalledWith('copy');
    expect(result).toBe(true);
  });

  it('should fallback to execCommand when clipboard API is not available', async () => {
    // Mock navigator without clipboard
    vi.stubGlobal('navigator', {});

    const result = await copyToClipboard('test text');

    expect(execCommandSpy).toHaveBeenCalledWith('copy');
    expect(result).toBe(true);
  });

  it('should return false when both methods fail', async () => {
    // Mock navigator.clipboard to throw error
    writeTextSpy = vi.fn().mockRejectedValue(new Error('Clipboard API failed'));
    vi.stubGlobal('navigator', { clipboard: { writeText: writeTextSpy } });

    // Mock execCommand to fail
    execCommandSpy.mockReturnValue(false);

    const result = await copyToClipboard('test text');

    expect(writeTextSpy).toHaveBeenCalledWith('test text');
    expect(execCommandSpy).toHaveBeenCalledWith('copy');
    expect(result).toBe(false);
  });

  it('should return false when execCommand throws', async () => {
    // Mock navigator.clipboard to throw error
    writeTextSpy = vi.fn().mockRejectedValue(new Error('Clipboard API failed'));
    vi.stubGlobal('navigator', { clipboard: { writeText: writeTextSpy } });

    // Mock execCommand to throw
    execCommandSpy.mockImplementation(() => {
      throw new Error('execCommand failed');
    });

    const result = await copyToClipboard('test text');

    expect(writeTextSpy).toHaveBeenCalledWith('test text');
    expect(execCommandSpy).toHaveBeenCalledWith('copy');
    expect(result).toBe(false);
  });

  it('should clean up textarea element after copy', async () => {
    // Mock navigator without clipboard
    vi.stubGlobal('navigator', {});

    const appendChildSpy = vi.spyOn(document.body, 'appendChild');
    const removeChildSpy = vi.spyOn(document.body, 'removeChild');

    await copyToClipboard('test text');

    expect(appendChildSpy).toHaveBeenCalled();
    expect(removeChildSpy).toHaveBeenCalled();

    // Verify textarea was created with correct properties
    const textarea = appendChildSpy.mock.calls[0][0] as HTMLTextAreaElement;
    expect(textarea.value).toBe('test text');
    expect(textarea.style.position).toBe('fixed');
    expect(textarea.style.left).toBe('-999999px');
    expect(textarea.style.top).toBe('-999999px');
  });

  it('should clean up textarea even when execCommand fails', async () => {
    // Mock navigator without clipboard
    vi.stubGlobal('navigator', {});

    // Mock execCommand to fail
    execCommandSpy.mockReturnValue(false);

    const removeChildSpy = vi.spyOn(document.body, 'removeChild');

    await copyToClipboard('test text');

    expect(removeChildSpy).toHaveBeenCalled();
  });
});
