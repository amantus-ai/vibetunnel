import { spawnSync } from 'child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessUtils } from '../../server/pty/process-utils.js';

const itWithBash = existsSync('/bin/bash') ? it : it.skip;
const itWithTcsh = existsSync('/bin/tcsh') ? it : it.skip;

function captureFallbackArgs(
  shellPath: string,
  configName: string,
  aliasDefinition: string
): string[] {
  const tempHome = mkdtempSync(join(tmpdir(), 'vt-shell-fallback-'));
  const capturePath = join(tempHome, 'capture-args.sh');
  const captureOutputPath = join(tempHome, 'captured-args');
  const originalHome = process.env.HOME;
  const originalShell = process.env.SHELL;
  const expectedArgs = [
    'hello world',
    "it's done",
    '',
    '$HOME; echo injected',
    '-n',
    'line1\nline2',
    'double"quote',
    'back\\slash',
  ];

  try {
    writeFileSync(
      capturePath,
      '#!/bin/sh\nprintf \'%s\\000\' "$@" > "$VT_CAPTURE_OUTPUT"\n',
      'utf8'
    );
    chmodSync(capturePath, 0o755);
    writeFileSync(
      join(tempHome, configName),
      aliasDefinition.replace('$CAPTURE', capturePath),
      'utf8'
    );

    let testShellPath = shellPath;
    if (shellPath === '/bin/bash') {
      const binDir = join(tempHome, 'bin');
      mkdirSync(binDir);
      testShellPath = join(binDir, 'bash');
      writeFileSync(
        testShellPath,
        [
          '#!/bin/bash',
          'args=()',
          'for arg in "$@"; do',
          '  [[ "$arg" == "-l" ]] || args+=("$arg")',
          'done',
          `exec /bin/bash --noprofile --rcfile "$HOME/.bashrc" "\${args[@]}"`,
          '',
        ].join('\n'),
        'utf8'
      );
      chmodSync(testShellPath, 0o755);
    }

    process.env.HOME = tempHome;
    process.env.SHELL = testShellPath;

    const resolved = ProcessUtils.resolveCommand(['vt_test_alias', ...expectedArgs]);
    expect(resolved.resolvedFrom).toBe('alias');
    const result = spawnSync(resolved.command, resolved.args, {
      env: { ...process.env, HOME: tempHome, VT_CAPTURE_OUTPUT: captureOutputPath },
    });

    expect(result.status, result.stderr.toString('utf8')).toBe(0);
    const actualArgs = readFileSync(captureOutputPath, 'utf8').split('\0');
    actualArgs.pop();
    expect(actualArgs).toEqual(expectedArgs);
    return actualArgs;
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = originalShell;
    rmSync(tempHome, { recursive: true, force: true });
  }
}

describe('ProcessUtils command parsing', () => {
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
      const commandAfterC = result.args[cIndex + 1];
      if (result.resolvedFrom === 'path') {
        expect(commandAfterC).toBe('echo "hello"');
        expect(result.useShell).toBe(false);
      } else {
        expect(commandAfterC).toBe('/bin/zsh "$@"');
        expect(result.args.slice(cIndex + 2)).toEqual(['--', '-i', '-c', 'echo "hello"']);
        expect(['shell', 'alias']).toContain(result.resolvedFrom);
        expect(result.useShell).toBe(true);
      }
      expect(result.isInteractive).toBe(true);
    });

    it('should handle fallback behavior when -- is incorrectly passed (legacy test)', () => {
      // This documents legacy behavior before wrappers stripped leading `--`.
      // In practice, this scenario should no longer occur as callers remove `--` before calling ProcessUtils.
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
      const originalShell = process.env.SHELL;
      process.env.SHELL = '/bin/bash';

      try {
        const result = ProcessUtils.resolveCommand(command);
        const commandIndex = result.args.indexOf('-c') + 1;

        expect(result.useShell).toBe(true);
        expect(result.resolvedFrom).toBe('alias');
        expect(result.args[commandIndex]).toBe('myalias "$@"');
        expect(result.args.slice(commandIndex + 1)).toEqual(['--', '--some-flag']);
      } finally {
        if (originalShell === undefined) delete process.env.SHELL;
        else process.env.SHELL = originalShell;
      }
    });

    it('should pass fish fallback arguments through $argv', () => {
      const originalShell = process.env.SHELL;
      process.env.SHELL = '/bin/fish';

      try {
        const commandArgs = ['hello world', "it's done", '', '-n'];
        const result = ProcessUtils.resolveCommand(['myalias', ...commandArgs]);
        const commandIndex = result.args.indexOf('-c') + 1;

        expect(result.args[commandIndex]).toBe('myalias $argv');
        expect(result.args.slice(commandIndex + 1)).toEqual(commandArgs);
      } finally {
        if (originalShell === undefined) delete process.env.SHELL;
        else process.env.SHELL = originalShell;
      }
    });

    it('should reject shell syntax in unresolved command names', () => {
      expect(() =>
        ProcessUtils.resolveCommand(['missing; touch /tmp/vt-shell-injection', '--flag'])
      ).toThrow('Unsafe shell fallback command name');
      expect(() => ProcessUtils.resolveCommand(['FOO=bar', 'echo', 'injected'])).toThrow(
        'Unsafe shell fallback command name'
      );
    });

    itWithBash('should preserve arbitrary arguments through a Bash alias fallback', () => {
      captureFallbackArgs('/bin/bash', '.bashrc', "alias vt_test_alias='$CAPTURE'\n");
    });

    itWithTcsh('should preserve arbitrary arguments through a tcsh alias fallback', () => {
      captureFallbackArgs('/bin/tcsh', '.tcshrc', "alias vt_test_alias '$CAPTURE \\!*'\n");
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

  describe('wrapper command parsing integration', () => {
    it('should strip -- separator before passing to ProcessUtils', () => {
      // This is what should happen in wrappers before calling ProcessUtils
      const args = ['--', '/bin/zsh', '-i', '-c', 'echo "hello"'];

      // The fix: detect and remove the -- separator
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
      const commandAfterC = result.args[cIndex + 1];
      if (result.resolvedFrom === 'path') {
        expect(commandAfterC).toBe('claude --dangerously-skip-permissions');
        expect(result.useShell).toBe(false);
      } else {
        expect(commandAfterC).toBe('/bin/zsh "$@"');
        expect(result.args.slice(cIndex + 2)).toEqual([
          '--',
          '-i',
          '-c',
          'claude --dangerously-skip-permissions',
        ]);
        expect(['shell', 'alias']).toContain(result.resolvedFrom);
        expect(result.useShell).toBe(true);
      }
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
      const commandIndex = result.args.indexOf('-c') + 1;

      expect(result.useShell).toBe(true);
      expect(result.resolvedFrom).toBe('alias');
      expect(result.args[commandIndex]).toContain('nonexistentcommand123');
      expect(result.args.slice(commandIndex + 1)).toContain('--flag');
    });
  });
});
