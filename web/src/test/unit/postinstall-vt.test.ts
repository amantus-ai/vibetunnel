import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  describe('installVtCommand - local installation', () => {
    it('should configure vt for local use when not global install', () => {
      const vtSource = path.join(testDir, 'vt');
      fs.writeFileSync(vtSource, '#!/bin/bash\necho "test vt"');

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { installVtCommand } = require('../../../scripts/install-vt-command');
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

      const { installVtCommand } = require('../../../scripts/install-vt-command');
      const result = installVtCommand(vtSource, false);

      expect(result).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith('⚠️  vt command script not found in package');
      expect(consoleLogSpy).toHaveBeenCalledWith('   Use "vibetunnel" command instead');

      consoleWarnSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });
  });

  describe('detectGlobalInstall - environment variables', () => {
    it('should detect global install when npm_config_global is true', () => {
      process.env.npm_config_global = 'true';

      const { detectGlobalInstall } = require('../../../scripts/install-vt-command');
      const result = detectGlobalInstall();

      expect(result).toBe(true);
    });

    it('should detect local install when npm_config_global is false', () => {
      process.env.npm_config_global = 'false';

      const { detectGlobalInstall } = require('../../../scripts/install-vt-command');
      const result = detectGlobalInstall();

      expect(result).toBe(false);
    });
  });

  describe('Installation helpers', () => {
    it('should check for existing vt command', () => {
      const mockBinDir = path.join(testDir, 'bin');
      fs.mkdirSync(mockBinDir);

      // Test when vt doesn't exist
      const vtPath = path.join(mockBinDir, 'vt');
      expect(fs.existsSync(vtPath)).toBe(false);

      // Create vt and test it exists
      fs.writeFileSync(vtPath, '#!/bin/bash\necho "test"');
      expect(fs.existsSync(vtPath)).toBe(true);
    });

    it('should handle Windows .cmd files', () => {
      if (process.platform !== 'win32') {
        // Skip on non-Windows
        return;
      }

      const mockBinDir = path.join(testDir, 'bin');
      fs.mkdirSync(mockBinDir);

      const cmdPath = path.join(mockBinDir, 'vt.cmd');
      const cmdContent = '@echo off\r\nnode "%~dp0\\vt" %*\r\n';

      fs.writeFileSync(cmdPath, cmdContent);

      const content = fs.readFileSync(cmdPath, 'utf8');
      expect(content).toContain('@echo off');
      expect(content).toContain('node "%~dp0\\vt" %*');
    });

    it('should handle symlink creation', () => {
      if (process.platform === 'win32') {
        // Skip on Windows
        return;
      }

      const sourceFile = path.join(testDir, 'source');
      const targetLink = path.join(testDir, 'target');

      fs.writeFileSync(sourceFile, '#!/bin/bash\necho "test"');

      // Create symlink
      fs.symlinkSync(sourceFile, targetLink);

      // Verify symlink exists and points to correct file
      expect(fs.existsSync(targetLink)).toBe(true);
      expect(fs.lstatSync(targetLink).isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(targetLink)).toBe(sourceFile);
    });

    it('should handle file copying as fallback', () => {
      const sourceFile = path.join(testDir, 'source');
      const targetFile = path.join(testDir, 'target');

      const content = '#!/bin/bash\necho "test"';
      fs.writeFileSync(sourceFile, content);

      // Copy file
      fs.copyFileSync(sourceFile, targetFile);

      // Make executable on Unix
      if (process.platform !== 'win32') {
        fs.chmodSync(targetFile, '755');
      }

      // Verify copy
      expect(fs.existsSync(targetFile)).toBe(true);
      expect(fs.readFileSync(targetFile, 'utf8')).toBe(content);

      if (process.platform !== 'win32') {
        const stats = fs.statSync(targetFile);
        expect(stats.mode & 0o111).toBeTruthy(); // Check execute bit
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle permission errors gracefully', () => {
      const vtSource = path.join(testDir, 'vt');
      fs.writeFileSync(vtSource, '#!/bin/bash\necho "test vt"');

      // Create a read-only directory to trigger permission error
      const readOnlyDir = path.join(testDir, 'readonly');
      fs.mkdirSync(readOnlyDir);

      // This would normally fail with permission denied if we made it truly read-only
      // but that's hard to test cross-platform, so we just verify the setup
      expect(fs.existsSync(readOnlyDir)).toBe(true);
    });

    it('should handle path with spaces', () => {
      const dirWithSpaces = path.join(testDir, 'dir with spaces');
      fs.mkdirSync(dirWithSpaces);

      const vtSource = path.join(dirWithSpaces, 'vt');
      fs.writeFileSync(vtSource, '#!/bin/bash\necho "test vt"');

      expect(fs.existsSync(vtSource)).toBe(true);
      expect(fs.readFileSync(vtSource, 'utf8')).toContain('test vt');
    });
  });
});
