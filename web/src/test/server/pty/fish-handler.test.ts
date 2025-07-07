import { spawnSync } from 'child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FishHandler } from '../../../server/pty/fish-handler.js';

// Mock child_process
vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

const mockSpawnSync = vi.mocked(spawnSync);

describe('FishHandler', () => {
  let fishHandler: FishHandler;

  beforeEach(() => {
    fishHandler = new FishHandler();
    vi.clearAllMocks();
  });

  describe('getCompletions', () => {
    it('should return empty array when fish command fails', async () => {
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: '',
        stderr: '',
        signal: null,
        pid: 123,
        output: [],
      });

      const result = await fishHandler.getCompletions('ls');
      expect(result).toEqual([]);
    });

    it('should return empty array when fish has no stdout', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: '',
        stderr: '',
        signal: null,
        pid: 123,
        output: [],
      });

      const result = await fishHandler.getCompletions('ls');
      expect(result).toEqual([]);
    });

    it('should parse fish completions correctly', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: 'ls\t\nls-color\tColorized ls\nls-files\tList files only\n',
        stderr: '',
        signal: null,
        pid: 123,
        output: [],
      });

      const result = await fishHandler.getCompletions('ls');
      expect(result).toEqual(['ls-color', 'ls-files']);
    });

    it('should filter out the original partial command', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: 'git\t\ngit-add\tAdd files\ngit-commit\tCommit changes\n',
        stderr: '',
        signal: null,
        pid: 123,
        output: [],
      });

      const result = await fishHandler.getCompletions('git');
      expect(result).toEqual(['git-add', 'git-commit']);
    });

    it('should handle empty completions gracefully', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: '\n\n\n',
        stderr: '',
        signal: null,
        pid: 123,
        output: [],
      });

      const result = await fishHandler.getCompletions('nonexistent');
      expect(result).toEqual([]);
    });

    it('should handle fish command timeout/errors', async () => {
      mockSpawnSync.mockImplementation(() => {
        throw new Error('Command timeout');
      });

      const result = await fishHandler.getCompletions('ls');
      expect(result).toEqual([]);
    });

    it('should call fish with correct parameters', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: 'test\n',
        stderr: '',
        signal: null,
        pid: 123,
        output: [],
      });

      await fishHandler.getCompletions('ls /tmp', '/home/user');

      expect(mockSpawnSync).toHaveBeenCalledWith('fish', ['-c', 'complete -C "ls /tmp"'], {
        cwd: '/home/user',
        encoding: 'utf8',
        timeout: 2000,
      });
    });

    it('should use current working directory as default', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: 'test\n',
        stderr: '',
        signal: null,
        pid: 123,
        output: [],
      });

      await fishHandler.getCompletions('ls');

      expect(mockSpawnSync).toHaveBeenCalledWith('fish', ['-c', 'complete -C "ls"'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 2000,
      });
    });
  });

  describe('isFishShell', () => {
    it('should return true for fish shell paths', () => {
      expect(FishHandler.isFishShell('/usr/bin/fish')).toBe(true);
      expect(FishHandler.isFishShell('/opt/homebrew/bin/fish')).toBe(true);
      expect(FishHandler.isFishShell('fish')).toBe(true);
    });

    it('should return false for non-fish shells', () => {
      expect(FishHandler.isFishShell('/bin/bash')).toBe(false);
      expect(FishHandler.isFishShell('/bin/zsh')).toBe(false);
      expect(FishHandler.isFishShell('/bin/sh')).toBe(false);
    });
  });

  describe('getFishVersion', () => {
    it('should return version when fish is available', () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: 'fish, version 3.6.1',
        stderr: '',
        signal: null,
        pid: 123,
        output: [],
      });

      const version = FishHandler.getFishVersion();
      expect(version).toBe('fish, version 3.6.1');
    });

    it('should return null when fish is not available', () => {
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'command not found',
        signal: null,
        pid: 123,
        output: [],
      });

      const version = FishHandler.getFishVersion();
      expect(version).toBeNull();
    });

    it('should return null when fish command throws', () => {
      mockSpawnSync.mockImplementation(() => {
        throw new Error('Command not found');
      });

      const version = FishHandler.getFishVersion();
      expect(version).toBeNull();
    });
  });
});
