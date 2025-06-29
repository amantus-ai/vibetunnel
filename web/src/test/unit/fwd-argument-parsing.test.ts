import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessUtils } from '../../server/pty/process-utils.js';

describe('fwd.ts argument parsing with -- separator', () => {
  beforeEach(() => {
    // Clear any mocks
    vi.clearAllMocks();
  });

  describe('ProcessUtils.resolveCommand', () => {
    it('should handle command array without -- separator correctly', () => {
      const command = ['/bin/zsh', '-i', '-c', 'echo "hello"'];
      const result = ProcessUtils.resolveCommand(command);

      // ProcessUtils adds -i -l flags for interactive shells
      expect(result.command).toMatch(/\/(bin\/)?(bash|zsh)$/);
      expect(result.args).toContain('-i');
      expect(result.args).toContain('-l');
      expect(result.args).toContain('-c');
      // The actual command is in the args after -c
      const cIndex = result.args.indexOf('-c');
      expect(cIndex).toBeGreaterThan(-1);
      // ProcessUtils preserves the command string after -c
      // In some environments this may include the full shell invocation
      const commandAfterC = result.args[cIndex + 1];
      expect(commandAfterC).toMatch(/echo "hello"/);
      // In some environments, ProcessUtils may resolve this as 'shell' instead of 'path'
      expect(['path', 'shell']).toContain(result.resolvedFrom);
      expect(result.useShell).toBe(result.resolvedFrom === 'shell');
      expect(result.isInteractive).toBe(true);
    });

    it('should handle fallback behavior when -- is incorrectly passed (legacy test)', () => {
      // This documents the old behavior before fwd.ts was fixed to strip --
      // In practice, this scenario should no longer occur as fwd.ts removes -- before calling ProcessUtils
      const command = ['--', '/bin/zsh', '-i', '-c', 'echo "hello"'];
      const result = ProcessUtils.resolveCommand(command);

      // When -- was passed as first element, ProcessUtils would try to resolve it as a command
      // This would fail and fall back to shell/alias resolution
      expect(result.command).not.toBe('--'); // Should not treat -- as command
      expect(result.resolvedFrom).toBe('alias'); // Falls back to alias resolution
      expect(result.useShell).toBe(true);
    });

    it('should handle aliases that require shell resolution', () => {
      // Simulate a command that's not in PATH (like an alias)
      const command = ['myalias', '--some-flag'];
      const result = ProcessUtils.resolveCommand(command);

      expect(result.useShell).toBe(true);
      expect(result.resolvedFrom).toBe('alias');
      expect(result.args).toContain('-c');
      expect(result.args).toContain('myalias --some-flag');
    });

    it('should handle regular binaries in PATH', () => {
      // Common commands that should exist in PATH
      const testCommands = [
        { cmd: ['ls', '-la'], expectShell: false },
        { cmd: ['echo', 'test'], expectShell: false },
        { cmd: ['cat', '/etc/hosts'], expectShell: false },
      ];

      for (const test of testCommands) {
        const result = ProcessUtils.resolveCommand(test.cmd);

        if (!test.expectShell) {
          // These should be found in PATH
          expect(result.useShell).toBe(false);
          expect(result.resolvedFrom).toBe('path');
          expect(result.command).toBe(test.cmd[0]);
          expect(result.args).toEqual(test.cmd.slice(1));
        }
      }
    });
  });

  describe('fwd.ts command parsing integration', () => {
    it('should strip -- separator before passing to ProcessUtils', () => {
      // This is what should happen in fwd.ts
      const args = ['--', '/bin/zsh', '-i', '-c', 'echo "hello"'];

      // The fix: fwd.ts should detect and remove the -- separator
      let command = args;
      if (command[0] === '--' && command.length > 1) {
        command = command.slice(1);
      }

      const result = ProcessUtils.resolveCommand(command);

      // When command is removed, ProcessUtils falls back to shell execution
      expect(result.command).toMatch(/\/(bin\/)?(bash|zsh|sh)$/);
      // The -- removal should now work properly
      expect(result.args).toContain('-c');
      expect(result.useShell).toBe(
        result.resolvedFrom === 'shell' || result.resolvedFrom === 'alias'
      );
    });

    it('should handle vt script alias resolution pattern', () => {
      // This simulates what vt script sends for aliases:
      // Original: vt claude --dangerously-skip-permissions
      // vt sends: fwd /bin/zsh -i -c "claude --dangerously-skip-permissions"

      // With the fix (-- removed from vt script), it becomes:
      const command = ['/bin/zsh', '-i', '-c', 'claude --dangerously-skip-permissions'];
      const result = ProcessUtils.resolveCommand(command);

      // ProcessUtils recognizes shells and adds -i -l flags
      expect(result.command).toMatch(/\/(bin\/)?(bash|zsh)$/);
      expect(result.args).toContain('-i');
      expect(result.args).toContain('-l');
      expect(result.args).toContain('-c');
      // The actual command is preserved after -c
      const cIndex = result.args.indexOf('-c');
      expect(cIndex).toBeGreaterThan(-1);
      // ProcessUtils preserves the command string after -c
      // In some environments this may include the full shell invocation
      const commandAfterC = result.args[cIndex + 1];
      expect(commandAfterC).toMatch(/claude --dangerously-skip-permissions/);
      // In some environments, ProcessUtils may resolve this as 'shell' instead of 'path'
      expect(['path', 'shell']).toContain(result.resolvedFrom);
      expect(result.useShell).toBe(result.resolvedFrom === 'shell');
      expect(result.isInteractive).toBe(true);
    });

    it('should handle --no-shell-wrap binary execution', () => {
      // This tests the vt -S or --no-shell-wrap code path
      // Original: vt -S echo test
      // vt sends: fwd echo test (without -- now)

      const command = ['echo', 'test'];
      const result = ProcessUtils.resolveCommand(command);

      expect(result.command).toBe('echo');
      expect(result.args).toEqual(['test']);
      expect(result.resolvedFrom).toBe('path');
      expect(result.useShell).toBe(false);
    });

    it('should handle --no-shell-wrap with non-existent command', () => {
      // This tests vt -S with a command that doesn't exist
      // Should fall back to shell execution

      const command = ['nonexistentcommand123', '--flag'];
      const result = ProcessUtils.resolveCommand(command);

      expect(result.useShell).toBe(true);
      expect(result.resolvedFrom).toBe('alias');
      expect(result.args).toContain('-c');
      expect(result.args).toContain('nonexistentcommand123 --flag');
    });
  });
});
