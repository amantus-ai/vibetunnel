import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VerbosityLevel } from '../../server/utils/logger';
import { parseVerbosityFromEnv } from '../../server/utils/verbosity-parser';

describe('Verbosity Parser', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables before each test
    process.env = { ...originalEnv };
    delete process.env.SHELLOPS_LOG_LEVEL;
    delete process.env.SHELLOPS_DEBUG;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('parseVerbosityFromEnv', () => {
    it('should return undefined when no environment variables are set', () => {
      expect(parseVerbosityFromEnv()).toBeUndefined();
    });

    it('should parse SHELLOPS_LOG_LEVEL correctly', () => {
      process.env.SHELLOPS_LOG_LEVEL = 'info';
      expect(parseVerbosityFromEnv()).toBe(VerbosityLevel.INFO);

      process.env.SHELLOPS_LOG_LEVEL = 'DEBUG';
      expect(parseVerbosityFromEnv()).toBe(VerbosityLevel.DEBUG);

      process.env.SHELLOPS_LOG_LEVEL = 'silent';
      expect(parseVerbosityFromEnv()).toBe(VerbosityLevel.SILENT);
    });

    it('should return undefined for invalid SHELLOPS_LOG_LEVEL', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      process.env.SHELLOPS_LOG_LEVEL = 'invalid';
      expect(parseVerbosityFromEnv()).toBeUndefined();

      expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
      expect(consoleWarnSpy).toHaveBeenCalledWith('Invalid SHELLOPS_LOG_LEVEL: invalid');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Valid levels: silent, error, warn, info, verbose, debug'
      );

      consoleWarnSpy.mockRestore();
    });

    it('should handle SHELLOPS_DEBUG=1', () => {
      process.env.SHELLOPS_DEBUG = '1';
      expect(parseVerbosityFromEnv()).toBe(VerbosityLevel.DEBUG);
    });

    it('should handle SHELLOPS_DEBUG=true', () => {
      process.env.SHELLOPS_DEBUG = 'true';
      expect(parseVerbosityFromEnv()).toBe(VerbosityLevel.DEBUG);
    });

    it('should ignore SHELLOPS_DEBUG when set to other values', () => {
      process.env.SHELLOPS_DEBUG = '0';
      expect(parseVerbosityFromEnv()).toBeUndefined();

      process.env.SHELLOPS_DEBUG = 'false';
      expect(parseVerbosityFromEnv()).toBeUndefined();

      process.env.SHELLOPS_DEBUG = 'yes';
      expect(parseVerbosityFromEnv()).toBeUndefined();
    });

    it('should prioritize SHELLOPS_LOG_LEVEL over SHELLOPS_DEBUG', () => {
      process.env.SHELLOPS_LOG_LEVEL = 'warn';
      process.env.SHELLOPS_DEBUG = '1';
      expect(parseVerbosityFromEnv()).toBe(VerbosityLevel.WARN);
    });

    it('should return DEBUG when SHELLOPS_LOG_LEVEL is invalid but SHELLOPS_DEBUG is set', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      process.env.SHELLOPS_LOG_LEVEL = 'invalid';
      process.env.SHELLOPS_DEBUG = '1';
      expect(parseVerbosityFromEnv()).toBe(VerbosityLevel.DEBUG);

      expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
      expect(consoleWarnSpy).toHaveBeenCalledWith('Invalid SHELLOPS_LOG_LEVEL: invalid');

      consoleWarnSpy.mockRestore();
    });
  });
});
