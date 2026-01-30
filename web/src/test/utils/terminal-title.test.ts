import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  extractCdDirectory,
  generateTitleSequence,
  injectTitleIfNeeded,
  shouldInjectTitle,
} from '../../server/utils/terminal-title.js';

// Mock os.homedir
vi.mock('os', async () => {
  const actual = (await vi.importActual('os')) as typeof import('os');
  return {
    ...actual,
    homedir: vi.fn(() => '/home/user'),
  };
});

describe('Terminal Title Utilities', () => {
  describe('generateTitleSequence', () => {
    it('should generate OSC 2 sequence with path and command', () => {
      const cwd = '/home/user/projects';
      const command = ['vim', 'file.txt'];
      const result = generateTitleSequence(cwd, command);
      expect(result).toBe('\x1B]2;~/projects · vim\x07');
    });

    it('should replace home directory with ~', () => {
      const cwd = '/home/user/Documents';
      const command = ['zsh'];
      const result = generateTitleSequence(cwd, command);
      expect(result).toBe('\x1B]2;~/Documents · zsh\x07');
    });

    it('should handle paths not in home directory', () => {
      const cwd = '/usr/local/bin';
      const command = ['ls'];
      const result = generateTitleSequence(cwd, command);
      expect(result).toBe('\x1B]2;/usr/local/bin · ls\x07');
    });

    it('should handle empty command array', () => {
      const cwd = '/home/user';
      const command: string[] = [];
      const result = generateTitleSequence(cwd, command);
      expect(result).toBe('\x1B]2;~ · shell\x07');
    });

    it('should use only the first command element', () => {
      const cwd = '/home/user';
      const command = ['git', 'status', '--porcelain'];
      const result = generateTitleSequence(cwd, command);
      expect(result).toBe('\x1B]2;~ · git\x07');
    });

    it('should use only session name when provided (non-auto-generated)', () => {
      const cwd = '/home/user/projects';
      const command = ['npm', 'run', 'dev'];
      const sessionName = 'Frontend Dev';
      const result = generateTitleSequence(cwd, command, sessionName);
      expect(result).toBe('\x1B]2;Frontend Dev\x07');
    });

    it('should skip redundant session names like "claude · claude"', () => {
      const cwd = '/home/user/projects';
      const command = ['claude'];
      const sessionName = 'claude · claude';
      const result = generateTitleSequence(cwd, command, sessionName);
      expect(result).toBe('\x1B]2;~/projects · claude\x07');
    });

    it('should skip auto-generated session names with path', () => {
      const cwd = '/home/user/projects';
      const command = ['python3'];
      const sessionName = 'python3 (~/projects)';
      const result = generateTitleSequence(cwd, command, sessionName);
      expect(result).toBe('\x1B]2;~/projects · python3\x07');
    });

    it('should skip session names that are just the command name', () => {
      const cwd = '/home/user';
      const command = ['bash'];
      const sessionName = 'bash';
      const result = generateTitleSequence(cwd, command, sessionName);
      expect(result).toBe('\x1B]2;~ · bash\x07');
    });

    it('should use only custom session names that are not redundant', () => {
      const cwd = '/home/user/projects';
      const command = ['claude'];
      const sessionName = 'Working on VibeTunnel';
      const result = generateTitleSequence(cwd, command, sessionName);
      expect(result).toBe('\x1B]2;Working on VibeTunnel\x07');
    });

    it('should handle empty session name', () => {
      const cwd = '/home/user';
      const command = ['vim'];
      const result = generateTitleSequence(cwd, command, '');
      expect(result).toBe('\x1B]2;~ · vim\x07');
    });

    it('should handle whitespace-only session name', () => {
      const cwd = '/home/user';
      const command = ['bash'];
      const result = generateTitleSequence(cwd, command, '   ');
      expect(result).toBe('\x1B]2;~ · bash\x07');
    });
  });

  describe('extractCdDirectory', () => {
    const currentDir = '/home/user/projects';

    it('should extract simple cd commands', () => {
      expect(extractCdDirectory('cd /tmp', currentDir)).toBe('/tmp');
      expect(extractCdDirectory('cd Documents', currentDir)).toBe(
        path.resolve(currentDir, 'Documents')
      );
    });

    it('should handle cd with quotes', () => {
      expect(extractCdDirectory('cd "My Documents"', currentDir)).toBe(
        path.resolve(currentDir, 'My Documents')
      );
      expect(extractCdDirectory("cd 'My Files'", currentDir)).toBe(
        path.resolve(currentDir, 'My Files')
      );
    });

    it('should handle cd ~ to home directory', () => {
      expect(extractCdDirectory('cd ~', currentDir)).toBe('/home/user');
      // Plain 'cd' without arguments should go to home directory
      expect(extractCdDirectory('cd', currentDir)).toBe('/home/user');
      expect(extractCdDirectory('cd\n', currentDir)).toBe('/home/user');
    });

    it('should handle cd with home directory path', () => {
      expect(extractCdDirectory('cd ~/Documents', currentDir)).toBe('/home/user/Documents');
      expect(extractCdDirectory('cd ~/projects/app', currentDir)).toBe('/home/user/projects/app');
    });

    it('should handle cd with trailing commands', () => {
      expect(extractCdDirectory('cd /tmp && ls', currentDir)).toBe('/tmp');
      expect(extractCdDirectory('cd src; npm test', currentDir)).toBe(
        path.resolve(currentDir, 'src')
      );
      expect(extractCdDirectory('cd build | head', currentDir)).toBe(
        path.resolve(currentDir, 'build')
      );
    });

    it('should handle cd - (previous directory) by returning null', () => {
      expect(extractCdDirectory('cd -', currentDir)).toBeNull();
    });

    it('should handle relative paths', () => {
      expect(extractCdDirectory('cd ..', currentDir)).toBe('/home/user');
      expect(extractCdDirectory('cd ../..', currentDir)).toBe('/home');
      expect(extractCdDirectory('cd ./src', currentDir)).toBe(path.resolve(currentDir, 'src'));
    });

    it('should return null for non-cd commands', () => {
      expect(extractCdDirectory('ls -la', currentDir)).toBeNull();
      expect(extractCdDirectory('echo cd /tmp', currentDir)).toBeNull();
      expect(extractCdDirectory('# cd /tmp', currentDir)).toBeNull();
    });

    it('should handle whitespace variations', () => {
      expect(extractCdDirectory('  cd   /tmp  ', currentDir)).toBe('/tmp');
      expect(extractCdDirectory('\tcd\t/tmp', currentDir)).toBe('/tmp');
    });

    it('should handle cd without arguments in different contexts', () => {
      expect(extractCdDirectory('cd && ls', currentDir)).toBe('/home/user');
      expect(extractCdDirectory('cd;pwd', currentDir)).toBe('/home/user');
      expect(extractCdDirectory('cd | tee log', currentDir)).toBe('/home/user');
    });
  });

  describe('shouldInjectTitle', () => {
    it('should detect common shell prompts', () => {
      expect(shouldInjectTitle('user@host:~$ ')).toBe(true);
      expect(shouldInjectTitle('> ')).toBe(true);
      expect(shouldInjectTitle('root@server:/# ')).toBe(true);
      expect(shouldInjectTitle('[user@host dir]$ ')).toBe(true);
      expect(shouldInjectTitle('[root@host]# ')).toBe(true);
    });

    it('should detect modern prompt arrows', () => {
      // These need to end with the arrow to match our patterns
      expect(shouldInjectTitle('~/projects ❯ ')).toBe(true);
      // This one has extra spaces between arrow and tilde, not matching our pattern
      expect(shouldInjectTitle('➜ ')).toBe(true);
    });

    it('should detect prompts with escape sequences', () => {
      expect(shouldInjectTitle('$ \x1B[0m')).toBe(true);
      expect(shouldInjectTitle('> \x1B[32m')).toBe(true);
    });

    it('should not detect non-prompt endings', () => {
      expect(shouldInjectTitle('This is some output')).toBe(false);
      expect(shouldInjectTitle('echo $PATH')).toBe(false);
      expect(shouldInjectTitle('# This is a comment')).toBe(false);
    });

    it('should handle multi-line output with prompt at end', () => {
      const output = 'Command output\nMore output\nuser@host:~$ ';
      expect(shouldInjectTitle(output)).toBe(true);
    });
  });

  describe('injectTitleIfNeeded', () => {
    const titleSequence = '\x1B]2;~/projects · vim\x07';

    it('should inject title when prompt is detected', () => {
      const data = 'user@host:~$ ';
      const result = injectTitleIfNeeded(data, titleSequence);
      expect(result).toBe(titleSequence + data);
    });

    it('should not inject title when no prompt is detected', () => {
      const data = 'Regular output text';
      const result = injectTitleIfNeeded(data, titleSequence);
      expect(result).toBe(data);
    });

    it('should inject at the beginning of output with prompt', () => {
      const data = 'Command completed.\nuser@host:~$ ';
      const result = injectTitleIfNeeded(data, titleSequence);
      expect(result).toBe(titleSequence + data);
    });

    it('should handle empty data', () => {
      const result = injectTitleIfNeeded('', titleSequence);
      expect(result).toBe('');
    });
  });
});
