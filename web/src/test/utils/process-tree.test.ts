import { execSync } from 'child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  getClaudeCommandFromTree,
  getProcessTree,
  isClaudeInProcessTree,
} from '../../server/utils/process-tree';

// Mock child_process
vi.mock('child_process');

describe('process-tree', () => {
  describe('getProcessTree', () => {
    it('should parse process tree correctly', () => {
      // Mock outputs for each ps call as it walks up the tree
      const output1 = `  PID  PPID COMMAND
12345 67890 /usr/bin/node /path/to/app.js`;

      const output2 = `  PID  PPID COMMAND
67890   123 /bin/bash`;

      const output3 = `  PID  PPID COMMAND
  123     1 /sbin/init`;

      vi.mocked(execSync)
        .mockReturnValueOnce(output1)
        .mockReturnValueOnce(output2)
        .mockReturnValueOnce(output3);

      const tree = getProcessTree();

      expect(tree).toHaveLength(3);
      expect(tree[0]).toEqual({
        pid: 12345,
        ppid: 67890,
        command: '/usr/bin/node /path/to/app.js',
      });
      expect(tree[1]).toEqual({
        pid: 67890,
        ppid: 123,
        command: '/bin/bash',
      });
      expect(tree[2]).toEqual({
        pid: 123,
        ppid: 1,
        command: '/sbin/init',
      });
    });

    it('should handle processes with spaces in command', () => {
      const mockOutput = `  PID  PPID COMMAND
12345 67890 /usr/bin/claude --resume "My Session"`;

      vi.mocked(execSync).mockReturnValueOnce(mockOutput);

      const tree = getProcessTree();

      expect(tree[0].command).toBe('/usr/bin/claude --resume "My Session"');
    });

    it('should handle ps command failures gracefully', () => {
      vi.mocked(execSync).mockImplementationOnce(() => {
        throw new Error('ps command failed');
      });

      const tree = getProcessTree();

      expect(tree).toEqual([]);
    });
  });

  describe('isClaudeInProcessTree', () => {
    it('should detect claude in direct command', () => {
      const mockOutput = `  PID  PPID COMMAND
12345 67890 /usr/bin/claude --resume
67890   123 /bin/bash`;

      vi.mocked(execSync)
        .mockReturnValueOnce(mockOutput)
        .mockReturnValueOnce(mockOutput.split('\n').slice(0, 3).join('\n'));

      expect(isClaudeInProcessTree()).toBe(true);
    });

    it('should detect cly wrapper', () => {
      const output1 = `  PID  PPID COMMAND
12345 67890 /usr/bin/node /path/to/app.js`;

      const output2 = `  PID  PPID COMMAND
67890 11111 cly --verbose`;

      const output3 = `  PID  PPID COMMAND
11111   123 /bin/zsh`;

      vi.mocked(execSync)
        .mockReturnValueOnce(output1)
        .mockReturnValueOnce(output2)
        .mockReturnValueOnce(output3);

      expect(isClaudeInProcessTree()).toBe(true);
    });

    it('should detect claude-wrapper script', () => {
      const output1 = `  PID  PPID COMMAND
12345 67890 /usr/bin/node app.js`;

      const output2 = `  PID  PPID COMMAND
67890 11111 /bin/zsh /Users/user/.config/zsh/claude-wrapper.zsh`;

      const output3 = `  PID  PPID COMMAND
11111   123 /bin/zsh`;

      vi.mocked(execSync)
        .mockReturnValueOnce(output1)
        .mockReturnValueOnce(output2)
        .mockReturnValueOnce(output3);

      expect(isClaudeInProcessTree()).toBe(true);
    });

    it('should detect node running claude', () => {
      const mockOutput = `  PID  PPID COMMAND
12345 67890 /usr/bin/node /usr/local/bin/claude --resume`;

      vi.mocked(execSync).mockReturnValueOnce(mockOutput);

      expect(isClaudeInProcessTree()).toBe(true);
    });

    it('should detect npx claude', () => {
      const mockOutput = `  PID  PPID COMMAND
12345 67890 /usr/bin/node /path/to/npx claude code`;

      vi.mocked(execSync).mockReturnValueOnce(mockOutput);

      expect(isClaudeInProcessTree()).toBe(true);
    });

    it('should return false when claude is not in tree', () => {
      const mockOutput = `  PID  PPID COMMAND
12345 67890 /usr/bin/node /path/to/other-app.js
67890   123 /bin/bash
  123     1 /sbin/init`;

      vi.mocked(execSync)
        .mockReturnValueOnce(mockOutput)
        .mockReturnValueOnce(mockOutput.split('\n').slice(0, 3).join('\n'))
        .mockReturnValueOnce(mockOutput.split('\n').slice(0, 2).join('\n'));

      expect(isClaudeInProcessTree()).toBe(false);
    });

    it('should handle process tree check failures', () => {
      vi.mocked(execSync).mockImplementationOnce(() => {
        throw new Error('ps failed');
      });

      expect(isClaudeInProcessTree()).toBe(false);
    });
  });

  describe('getClaudeCommandFromTree', () => {
    it('should return claude command when found', () => {
      const mockOutput = `  PID  PPID COMMAND
12345 67890 /usr/bin/claude --resume --verbose
67890   123 /bin/bash`;

      vi.mocked(execSync)
        .mockReturnValueOnce(mockOutput)
        .mockReturnValueOnce(mockOutput.split('\n').slice(0, 3).join('\n'));

      expect(getClaudeCommandFromTree()).toBe('/usr/bin/claude --resume --verbose');
    });

    it('should return cly command when found', () => {
      const output1 = `  PID  PPID COMMAND
12345 67890 /usr/bin/node app.js`;

      const output2 = `  PID  PPID COMMAND
67890 11111 cly --title "My Project"`;

      vi.mocked(execSync).mockReturnValueOnce(output1).mockReturnValueOnce(output2);

      expect(getClaudeCommandFromTree()).toBe('cly --title "My Project"');
    });

    it('should return null when claude not found', () => {
      const mockOutput = `  PID  PPID COMMAND
12345 67890 /usr/bin/node /path/to/app.js
67890   123 /bin/bash`;

      vi.mocked(execSync)
        .mockReturnValueOnce(mockOutput)
        .mockReturnValueOnce(mockOutput.split('\n').slice(0, 3).join('\n'));

      expect(getClaudeCommandFromTree()).toBe(null);
    });

    it('should handle failures gracefully', () => {
      vi.mocked(execSync).mockImplementationOnce(() => {
        throw new Error('ps failed');
      });

      expect(getClaudeCommandFromTree()).toBe(null);
    });
  });
});
