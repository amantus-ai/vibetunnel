import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Import the actual module we're testing
const {
  detectGlobalInstall,
  installVtCommand,
  getNpmBinDir,
} = require('../../../scripts/install-vt-command');

describe('postinstall vt installation', () => {
  let testDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Create a temporary directory for testing
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-test-'));
    originalEnv = { ...process.env };
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up
    process.env = originalEnv;
    fs.rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('installVtCommand', () => {
    it('should configure vt for local use when not global install', () => {
      const vtSource = path.join(testDir, 'vt');
      fs.writeFileSync(vtSource, '#!/bin/bash\necho "test vt"');

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = installVtCommand(vtSource, false);

      expect(result).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('✓ vt command configured for local use');
      expect(consoleSpy).toHaveBeenCalledWith('  Use "npx vt" to run the vt wrapper');

      // Check file is executable on Unix
      if (process.platform !== 'win32') {
        const stats = fs.statSync(vtSource);
        expect(stats.mode & 0o111).toBeTruthy(); // Check execute bit
      }

      consoleSpy.mockRestore();
    });

    it('should handle missing vt script gracefully', () => {
      const vtSource = path.join(testDir, 'nonexistent');
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = installVtCommand(vtSource, false);

      expect(result).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith('⚠️  vt command script not found in package');
      expect(consoleLogSpy).toHaveBeenCalledWith('   Use "vibetunnel" command instead');

      consoleWarnSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('should not overwrite existing vt command globally', () => {
      const vtSource = path.join(testDir, 'vt');
      fs.writeFileSync(vtSource, '#!/bin/bash\necho "test vt"');

      // Create a mock bin directory with existing vt
      const mockBinDir = path.join(testDir, 'bin');
      fs.mkdirSync(mockBinDir);
      fs.writeFileSync(path.join(mockBinDir, 'vt'), '#!/bin/bash\necho "existing vt"');

      // Mock execSync to return our test directory
      vi.spyOn(require('child_process'), 'execSync').mockImplementation((cmd: string) => {
        if (cmd.includes('npm config get prefix')) {
          return testDir + '\n';
        }
        throw new Error('Unexpected command');
      });

      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = installVtCommand(vtSource, true);

      expect(result).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith('⚠️  A "vt" command already exists in your system');

      // Verify existing vt wasn't overwritten
      const existingContent = fs.readFileSync(path.join(mockBinDir, 'vt'), 'utf8');
      expect(existingContent).toContain('existing vt');

      consoleLogSpy.mockRestore();
    });
  });

  describe('detectGlobalInstall', () => {
    it('should detect global install when npm_config_global is true', () => {
      process.env.npm_config_global = 'true';

      const result = detectGlobalInstall();

      expect(result).toBe(true);
    });

    it('should detect local install when npm_config_global is false', () => {
      process.env.npm_config_global = 'false';

      const result = detectGlobalInstall();

      expect(result).toBe(false);
    });

    it('should fall back to path detection when npm_config_global is not set', () => {
      delete process.env.npm_config_global;

      // Mock execSync
      const execSyncSpy = vi
        .spyOn(require('child_process'), 'execSync')
        .mockReturnValue('/usr/local\n');

      // Mock __dirname to be in global modules
      const originalDirname = __dirname;
      Object.defineProperty(global, '__dirname', {
        value: '/usr/local/lib/node_modules/vibetunnel/scripts',
        configurable: true,
      });

      const result = detectGlobalInstall();

      expect(result).toBe(true);
      expect(execSyncSpy).toHaveBeenCalledWith('npm config get prefix', { encoding: 'utf8' });

      // Restore
      Object.defineProperty(global, '__dirname', {
        value: originalDirname,
        configurable: true,
      });
      execSyncSpy.mockRestore();
    });

    it('should default to local install if detection fails', () => {
      delete process.env.npm_config_global;

      // Mock execSync to throw
      vi.spyOn(require('child_process'), 'execSync').mockImplementation(() => {
        throw new Error('Command failed');
      });

      const result = detectGlobalInstall();

      expect(result).toBe(false);
    });
  });

  describe('getNpmBinDir', () => {
    it('should return npm bin directory', () => {
      const mockPrefix = '/usr/local';
      vi.spyOn(require('child_process'), 'execSync').mockReturnValue(mockPrefix + '\n');

      const result = getNpmBinDir();

      expect(result).toBe(path.join(mockPrefix, 'bin'));
    });

    it('should handle errors gracefully', () => {
      vi.spyOn(require('child_process'), 'execSync').mockImplementation(() => {
        throw new Error('Command failed');
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = getNpmBinDir();

      expect(result).toBe(null);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '⚠️  Could not determine npm global bin directory'
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Windows support', () => {
    it('should create .cmd wrapper on Windows', () => {
      // Skip this test on non-Windows platforms
      if (process.platform !== 'win32') {
        return;
      }

      const vtSource = path.join(testDir, 'vt');
      fs.writeFileSync(vtSource, '#!/bin/bash\necho "test vt"');

      const mockBinDir = path.join(testDir, 'bin');
      fs.mkdirSync(mockBinDir);

      // Mock execSync to return our test directory
      vi.spyOn(require('child_process'), 'execSync').mockReturnValue(testDir + '\n');

      const result = installVtCommand(vtSource, true);

      expect(result).toBe(true);

      // Check that .cmd file was created
      const cmdPath = path.join(mockBinDir, 'vt.cmd');
      expect(fs.existsSync(cmdPath)).toBe(true);

      const cmdContent = fs.readFileSync(cmdPath, 'utf8');
      expect(cmdContent).toContain('@echo off');
      expect(cmdContent).toContain('node "%~dp0\\vt" %*');
    });
  });
});
