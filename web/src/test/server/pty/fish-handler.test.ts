import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FishHandler } from '../../../server/pty/fish-handler.js';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';

const mockSpawn = vi.mocked(spawn);

// Helper to create mock process
const createMockProcess = (stdout: string, exitCode: number = 0, shouldError = false) => {
  const mockProcess = {
    stdout: {
      on: vi.fn((event, callback) => {
        if (event === 'data' && !shouldError) {
          callback(Buffer.from(stdout));
        }
      }),
    },
    on: vi.fn((event, callback) => {
      if (event === 'close') {
        setTimeout(() => callback(exitCode), 0);
      } else if (event === 'error' && shouldError) {
        setTimeout(() => callback(new Error('Process error')), 0);
      }
    }),
    kill: vi.fn(),
  };
  return mockProcess;
};

describe('FishHandler', () => {
  let fishHandler: FishHandler;

  beforeEach(() => {
    fishHandler = new FishHandler();
    vi.clearAllMocks();
  });

  describe('getCompletions', () => {
    it('should return empty array when fish command fails', async () => {
      const mockProcess = createMockProcess('', 1);
      mockSpawn.mockReturnValue(mockProcess);

      const result = await fishHandler.getCompletions('ls');
      expect(result).toEqual([]);
    });

    it('should return empty array when fish has no stdout', async () => {
      const mockProcess = createMockProcess('', 0);
      mockSpawn.mockReturnValue(mockProcess);

      const result = await fishHandler.getCompletions('ls');
      expect(result).toEqual([]);
    });

    it('should parse fish completions correctly', async () => {
      const mockProcess = createMockProcess(
        'ls\t\nls-color\tColorized ls\nls-files\tList files only\n',
        0
      );
      mockSpawn.mockReturnValue(mockProcess);

      const result = await fishHandler.getCompletions('ls');
      expect(result).toEqual(['ls-color', 'ls-files']);
    });

    it('should filter out the original partial command', async () => {
      const mockProcess = createMockProcess(
        'git\t\ngit-add\tAdd files\ngit-commit\tCommit changes\n',
        0
      );
      mockSpawn.mockReturnValue(mockProcess);

      const result = await fishHandler.getCompletions('git');
      expect(result).toEqual(['git-add', 'git-commit']);
    });

    it('should handle empty completions gracefully', async () => {
      const mockProcess = createMockProcess('\n\n\n', 0);
      mockSpawn.mockReturnValue(mockProcess);

      const result = await fishHandler.getCompletions('nonexistent');
      expect(result).toEqual([]);
    });

    it('should handle fish command timeout/errors', async () => {
      const mockProcess = createMockProcess('', 0, true);
      mockSpawn.mockReturnValue(mockProcess);

      const result = await fishHandler.getCompletions('ls');
      expect(result).toEqual([]);
    });

    it('should call fish with correct parameters', async () => {
      const mockProcess = createMockProcess('test\n', 0);
      mockSpawn.mockReturnValue(mockProcess);

      await fishHandler.getCompletions('ls /tmp', '/home/user');

      expect(mockSpawn).toHaveBeenCalledWith('fish', ['-c', 'complete -C "ls /tmp"'], {
        cwd: '/home/user',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    });

    it('should use current working directory as default', async () => {
      const mockProcess = createMockProcess('test\n', 0);
      mockSpawn.mockReturnValue(mockProcess);

      await fishHandler.getCompletions('ls');

      expect(mockSpawn).toHaveBeenCalledWith('fish', ['-c', 'complete -C "ls"'], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    });
  });

  describe('isFishShell', () => {
    it('should return true for fish shell paths', () => {
      expect(FishHandler.isFishShell('/usr/bin/fish')).toBe(true);
      expect(FishHandler.isFishShell('/opt/homebrew/bin/fish')).toBe(true);
      expect(FishHandler.isFishShell('fish')).toBe(true);
      expect(FishHandler.isFishShell('/usr/bin/fish3')).toBe(true);
    });

    it('should return false for non-fish shells', () => {
      expect(FishHandler.isFishShell('/bin/bash')).toBe(false);
      expect(FishHandler.isFishShell('/bin/zsh')).toBe(false);
      expect(FishHandler.isFishShell('/bin/sh')).toBe(false);
      expect(FishHandler.isFishShell('/usr/bin/catfish')).toBe(false);
      expect(FishHandler.isFishShell('/usr/bin/fisherman')).toBe(false);
    });
  });

  describe('getFishVersion', () => {
    it('should return version when fish is available', async () => {
      const mockProcess = createMockProcess('fish, version 3.6.1', 0);
      mockSpawn.mockReturnValue(mockProcess);

      const version = await FishHandler.getFishVersion();
      expect(version).toBe('fish, version 3.6.1');
    });

    it('should return null when fish is not available', async () => {
      const mockProcess = createMockProcess('', 1);
      mockSpawn.mockReturnValue(mockProcess);

      const version = await FishHandler.getFishVersion();
      expect(version).toBeNull();
    });

    it('should return null when fish command throws', async () => {
      const mockProcess = createMockProcess('', 0, true);
      mockSpawn.mockReturnValue(mockProcess);

      const version = await FishHandler.getFishVersion();
      expect(version).toBeNull();
    });
  });
});
