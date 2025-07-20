import { describe, expect, it } from 'vitest';
import { formatCommand, parseCommand } from './command-utils';

describe('command-utils', () => {
  describe('parseCommand', () => {
    it('should parse simple commands', () => {
      expect(parseCommand('ls')).toEqual(['ls']);
      expect(parseCommand('ls -la')).toEqual(['ls', '-la']);
      expect(parseCommand('npm run dev')).toEqual(['npm', 'run', 'dev']);
    });

    it('should handle double quotes', () => {
      expect(parseCommand('echo "hello world"')).toEqual(['echo', 'hello world']);
      expect(parseCommand('git commit -m "Initial commit"')).toEqual([
        'git',
        'commit',
        '-m',
        'Initial commit',
      ]);
    });

    it('should handle single quotes', () => {
      expect(parseCommand("echo 'hello world'")).toEqual(['echo', 'hello world']);
      expect(parseCommand("ls -la '/my path/with spaces'")).toEqual([
        'ls',
        '-la',
        '/my path/with spaces',
      ]);
    });

    it('should handle mixed quotes', () => {
      expect(parseCommand(`echo "It's working"`)).toEqual(['echo', "It's working"]);
      expect(parseCommand(`echo 'He said "hello"'`)).toEqual(['echo', 'He said "hello"']);
    });

    it('should handle multiple spaces', () => {
      expect(parseCommand('ls    -la')).toEqual(['ls', '-la']);
      expect(parseCommand('  npm   run   dev  ')).toEqual(['npm', 'run', 'dev']);
    });

    it('should handle empty strings', () => {
      expect(parseCommand('')).toEqual([]);
      expect(parseCommand('   ')).toEqual([]);
    });

    it('should handle commands with paths', () => {
      expect(parseCommand('/usr/bin/python3 script.py')).toEqual(['/usr/bin/python3', 'script.py']);
      expect(parseCommand('cd "/Users/john/My Documents"')).toEqual([
        'cd',
        '/Users/john/My Documents',
      ]);
    });

    it('should handle complex commands', () => {
      expect(parseCommand('docker run -it --rm -v "/home/user:/app" node:latest npm test')).toEqual(
        ['docker', 'run', '-it', '--rm', '-v', '/home/user:/app', 'node:latest', 'npm', 'test']
      );
    });

    it('should handle quotes at the beginning and end', () => {
      expect(parseCommand('"quoted command"')).toEqual(['quoted command']);
      expect(parseCommand("'single quoted'")).toEqual(['single quoted']);
    });

    it('should handle unclosed quotes by including them literally', () => {
      expect(parseCommand('echo "unclosed')).toEqual(['echo', 'unclosed']);
      expect(parseCommand("echo 'unclosed")).toEqual(['echo', 'unclosed']);
    });

    it('should handle environment variables', () => {
      expect(parseCommand('FOO=bar BAZ="with spaces" npm test')).toEqual([
        'FOO=bar',
        'BAZ=with spaces',
        'npm',
        'test',
      ]);
    });
  });

  describe('formatCommand', () => {
    it('should format simple commands', () => {
      expect(formatCommand(['ls'])).toBe('ls');
      expect(formatCommand(['ls', '-la'])).toBe('ls -la');
      expect(formatCommand(['npm', 'run', 'dev'])).toBe('npm run dev');
    });

    it('should add quotes to arguments with spaces', () => {
      expect(formatCommand(['echo', 'hello world'])).toBe('echo "hello world"');
      expect(formatCommand(['cd', '/my path/with spaces'])).toBe('cd "/my path/with spaces"');
    });

    it('should escape double quotes in arguments', () => {
      expect(formatCommand(['echo', 'He said "hello"'])).toBe('echo "He said \\"hello\\""');
      expect(formatCommand(['echo', '"quoted"'])).toBe('echo "quoted"'); // No spaces, no quotes added
    });

    it('should handle empty arrays', () => {
      expect(formatCommand([])).toBe('');
    });

    it('should handle single arguments with spaces', () => {
      expect(formatCommand(['my command'])).toBe('"my command"');
    });

    it('should not quote arguments without spaces', () => {
      expect(formatCommand(['--option=value'])).toBe('--option=value');
      expect(formatCommand(['-v', '/home/user:/app'])).toBe('-v /home/user:/app');
    });

    it('should handle complex commands', () => {
      expect(
        formatCommand([
          'docker',
          'run',
          '-it',
          '--rm',
          '-v',
          '/home/user:/app',
          'node:latest',
          'npm',
          'test',
        ])
      ).toBe('docker run -it --rm -v /home/user:/app node:latest npm test');
    });

    it('should round-trip with parseCommand', () => {
      const commands = [
        'ls -la',
        'echo "hello world"',
        'git commit -m "Initial commit"',
        'cd "/Users/john/My Documents"',
      ];

      commands.forEach((cmd) => {
        const parsed = parseCommand(cmd);
        const formatted = formatCommand(parsed);
        const reparsed = parseCommand(formatted);
        expect(reparsed).toEqual(parsed);
      });
    });
  });
});
