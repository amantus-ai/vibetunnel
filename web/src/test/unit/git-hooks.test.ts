import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Create mock functions
const mockMkdir = vi.fn();
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockChmod = vi.fn();
const mockUnlink = vi.fn();
const mockAccess = vi.fn();
const mockExecFile = vi.fn();

// Mock fs/promises
vi.mock('fs/promises', () => ({
  mkdir: mockMkdir,
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  chmod: mockChmod,
  unlink: mockUnlink,
  access: mockAccess,
}));

// Mock child_process
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

// Mock util
vi.mock('util', () => ({
  promisify: vi.fn(() => mockExecFile),
}));

// Mock logger
vi.mock('../../server/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  })),
}));

// Import after mocks are set up
const gitHooksModule = await import('../../server/utils/git-hooks.js');
const { areHooksInstalled, installGitHooks, uninstallGitHooks } = gitHooksModule;

describe('Git Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockChmod.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('installGitHooks', () => {
    it('should install hooks successfully when no existing hooks', async () => {
      // Mock git config check (no custom hooks path)
      mockExecFile.mockRejectedValueOnce(new Error('key not found'));

      // Mock file system operations
      mockReadFile.mockRejectedValue(new Error('File not found'));

      const result = await installGitHooks('/home/user/project');

      expect(result).toEqual({ success: true });

      // Verify hooks directory was created
      expect(mockMkdir).toHaveBeenCalledWith('/home/user/project/.git/hooks', { recursive: true });

      // Verify hook files were written
      expect(mockWriteFile).toHaveBeenCalledTimes(2);
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/home/user/project/.git/hooks/post-commit',
        expect.stringContaining('VibeTunnel Git hook - post-commit')
      );
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/home/user/project/.git/hooks/post-checkout',
        expect.stringContaining('VibeTunnel Git hook - post-checkout')
      );

      // Verify hooks were made executable
      expect(mockChmod).toHaveBeenCalledTimes(2);
      expect(mockChmod).toHaveBeenCalledWith('/home/user/project/.git/hooks/post-commit', 0o755);
      expect(mockChmod).toHaveBeenCalledWith('/home/user/project/.git/hooks/post-checkout', 0o755);
    });

    it('should install hooks even when custom hooks path config fails', async () => {
      // Mock git config check fails (falls back to default)
      mockExecFile.mockRejectedValue(new Error('key not found'));

      // Mock file system operations
      mockReadFile.mockRejectedValue(new Error('File not found'));

      const result = await installGitHooks('/home/user/project');

      expect(result).toEqual({ success: true });

      // Verify default hooks directory was used
      expect(mockMkdir).toHaveBeenCalledWith('/home/user/project/.git/hooks', { recursive: true });

      // Verify both hooks were written
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/home/user/project/.git/hooks/post-commit',
        expect.stringContaining('VibeTunnel Git hook')
      );
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/home/user/project/.git/hooks/post-checkout',
        expect.stringContaining('VibeTunnel Git hook')
      );
    });

    it('should backup existing hooks and chain them', async () => {
      mockExecFile.mockRejectedValueOnce(new Error('key not found'));

      // Mock existing hook content
      const existingHookContent = '#!/bin/sh\necho "Existing hook"';
      mockReadFile
        .mockResolvedValueOnce(existingHookContent) // post-commit exists
        .mockRejectedValueOnce(new Error('File not found')); // post-checkout doesn't exist

      const result = await installGitHooks('/home/user/project');

      expect(result).toEqual({ success: true });

      // Verify backup was created
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/home/user/project/.git/hooks/post-commit.vtbak',
        existingHookContent
      );

      // Find the call that contains the chained hook
      const chainedHookCall = mockWriteFile.mock.calls.find(
        (call) =>
          call[0] === '/home/user/project/.git/hooks/post-commit' && call[1].includes('exec')
      );

      expect(chainedHookCall).toBeDefined();
      expect(chainedHookCall[1]).toContain(
        'exec "/home/user/project/.git/hooks/post-commit.vtbak" "$@"'
      );
    });

    it('should skip installation if hooks already installed', async () => {
      mockExecFile.mockRejectedValueOnce(new Error('key not found'));

      // Mock existing VibeTunnel hook
      mockReadFile.mockResolvedValue('#!/bin/sh\n# VibeTunnel Git hook - post-commit\n');

      const result = await installGitHooks('/home/user/project');

      expect(result).toEqual({ success: true });

      // Verify no new hooks were written (only read operations)
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('should handle installation errors', async () => {
      mockExecFile.mockRejectedValueOnce(new Error('key not found'));
      mockReadFile.mockRejectedValue(new Error('File not found'));
      mockWriteFile.mockRejectedValueOnce(new Error('Permission denied'));

      const result = await installGitHooks('/home/user/project');

      expect(result).toMatchObject({
        success: false,
        errors: expect.arrayContaining(['Permission denied']),
      });
    });
  });

  describe('uninstallGitHooks', () => {
    it('should uninstall hooks and handle various scenarios', async () => {
      // Git config check fails
      mockExecFile.mockRejectedValue(new Error('key not found'));

      // Set up readFile mocks - both hooks are ours
      mockReadFile
        .mockResolvedValueOnce('#!/bin/sh\n# VibeTunnel Git hook - post-commit\n')
        .mockResolvedValueOnce('#!/bin/sh\n# VibeTunnel Git hook - post-checkout\n');

      // Mock access checks - no backups exist
      mockAccess.mockRejectedValue(new Error('File not found'));

      const result = await uninstallGitHooks('/home/user/project');

      expect(result).toEqual({ success: true });

      // Verify both hooks were removed (no backups to restore)
      expect(mockUnlink).toHaveBeenCalledWith('/home/user/project/.git/hooks/post-commit');
      expect(mockUnlink).toHaveBeenCalledWith('/home/user/project/.git/hooks/post-checkout');
    });

    it('should skip uninstall if hooks are not ours', async () => {
      mockExecFile.mockRejectedValueOnce(new Error('key not found'));

      // Mock hooks that aren't ours
      mockReadFile
        .mockResolvedValueOnce('#!/bin/sh\necho "Different hook"')
        .mockResolvedValueOnce('#!/bin/sh\necho "Another hook"');

      const result = await uninstallGitHooks('/home/user/project');

      expect(result).toEqual({ success: true });

      // Verify no files were modified
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('should handle missing hooks gracefully', async () => {
      mockExecFile.mockRejectedValueOnce(new Error('key not found'));

      // Mock hooks don't exist
      mockReadFile.mockRejectedValue(new Error('File not found'));

      const result = await uninstallGitHooks('/home/user/project');

      expect(result).toEqual({ success: true });

      // Verify no operations were performed
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('should handle uninstall errors', async () => {
      mockExecFile.mockRejectedValueOnce(new Error('key not found'));
      mockReadFile.mockResolvedValue('#!/bin/sh\n# VibeTunnel Git hook - post-commit\n');
      mockAccess.mockRejectedValue(new Error('File not found'));
      mockUnlink.mockRejectedValueOnce(new Error('Permission denied'));

      const result = await uninstallGitHooks('/home/user/project');

      expect(result).toMatchObject({
        success: false,
        errors: expect.arrayContaining(['Permission denied']),
      });
    });
  });

  describe('areHooksInstalled', () => {
    it('should return true when all hooks are installed', async () => {
      mockExecFile.mockRejectedValueOnce(new Error('key not found'));

      // Mock both hooks exist and are ours
      mockReadFile
        .mockResolvedValueOnce('#!/bin/sh\n# VibeTunnel Git hook - post-commit\n')
        .mockResolvedValueOnce('#!/bin/sh\n# VibeTunnel Git hook - post-checkout\n');

      const result = await areHooksInstalled('/home/user/project');

      expect(result).toBe(true);
    });

    it('should return false when hooks are missing', async () => {
      mockExecFile.mockRejectedValueOnce(new Error('key not found'));

      // Mock first hook exists, second doesn't
      mockReadFile
        .mockResolvedValueOnce('#!/bin/sh\n# VibeTunnel Git hook - post-commit\n')
        .mockRejectedValueOnce(new Error('File not found'));

      const result = await areHooksInstalled('/home/user/project');

      expect(result).toBe(false);
    });

    it('should return false when hooks exist but are not ours', async () => {
      mockExecFile.mockRejectedValueOnce(new Error('key not found'));

      // Mock hooks exist but aren't ours
      mockReadFile
        .mockResolvedValueOnce('#!/bin/sh\necho "Different hook"')
        .mockResolvedValueOnce('#!/bin/sh\n# VibeTunnel Git hook - post-checkout\n');

      const result = await areHooksInstalled('/home/user/project');

      expect(result).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      // Mock git command error
      mockExecFile.mockRejectedValueOnce(new Error('Git command failed'));

      // When git command fails, we still check the default .git/hooks path
      // Mock hooks exist and are ours
      mockReadFile
        .mockResolvedValueOnce('#!/bin/sh\n# VibeTunnel Git hook - post-commit\n')
        .mockResolvedValueOnce('#!/bin/sh\n# VibeTunnel Git hook - post-checkout\n');

      const result = await areHooksInstalled('/home/user/project');

      // It still returns true because the hooks exist in the default location
      expect(result).toBe(true);
    });
  });
});
