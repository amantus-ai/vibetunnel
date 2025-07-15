import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLogger,
  getVerbosityLevel,
  initLogger,
  isDebugEnabled,
  isVerbose,
  isVerbosityLevel,
  parseVerbosityLevel,
  setVerbosityLevel,
  VERBOSITY_MAP,
  VerbosityLevel,
} from '../../server/utils/logger';

describe('Logger Verbosity Control', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Reset to default verbosity
    setVerbosityLevel(VerbosityLevel.ERROR);

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Verbosity Level Management', () => {
    it('should default to ERROR level', () => {
      expect(getVerbosityLevel()).toBe(VerbosityLevel.ERROR);
    });

    it('should set and get verbosity level', () => {
      setVerbosityLevel(VerbosityLevel.INFO);
      expect(getVerbosityLevel()).toBe(VerbosityLevel.INFO);

      setVerbosityLevel(VerbosityLevel.DEBUG);
      expect(getVerbosityLevel()).toBe(VerbosityLevel.DEBUG);
    });

    it('should initialize with custom verbosity', () => {
      initLogger(false, VerbosityLevel.WARN);
      expect(getVerbosityLevel()).toBe(VerbosityLevel.WARN);
    });

    it('should set DEBUG verbosity when debug mode is enabled', () => {
      initLogger(true);
      expect(getVerbosityLevel()).toBe(VerbosityLevel.DEBUG);
    });
  });

  describe('Console Output Control', () => {
    const logger = createLogger('test-module');

    it('should only show errors at ERROR level', () => {
      setVerbosityLevel(VerbosityLevel.ERROR);

      logger.log('info message');
      logger.warn('warning message');
      logger.error('error message');
      logger.debug('debug message');

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('error message'));
    });

    it('should show errors and warnings at WARN level', () => {
      setVerbosityLevel(VerbosityLevel.WARN);

      logger.log('info message');
      logger.warn('warning message');
      logger.error('error message');
      logger.debug('debug message');

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('should show info, warnings, and errors at INFO level', () => {
      setVerbosityLevel(VerbosityLevel.INFO);

      logger.log('info message');
      logger.warn('warning message');
      logger.error('error message');
      logger.debug('debug message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('should show all messages at DEBUG level', () => {
      setVerbosityLevel(VerbosityLevel.DEBUG);

      logger.log('info message');
      logger.warn('warning message');
      logger.error('error message');
      logger.debug('debug message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(2); // info + debug
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('should show nothing at SILENT level except critical errors', () => {
      setVerbosityLevel(VerbosityLevel.SILENT);

      logger.log('info message');
      logger.warn('warning message');
      logger.error('error message');
      logger.debug('debug message');

      // At SILENT level, even regular errors are suppressed
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should show all except debug at VERBOSE level', () => {
      setVerbosityLevel(VerbosityLevel.VERBOSE);

      logger.log('info message');
      logger.warn('warning message');
      logger.error('error message');
      logger.debug('debug message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1); // only info
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Backward Compatibility', () => {
    it('should support setDebugMode for backward compatibility', () => {
      const logger = createLogger('test-module');

      // Enable debug mode
      logger.setDebugMode(true);
      expect(getVerbosityLevel()).toBe(VerbosityLevel.DEBUG);

      // Debug messages should now appear
      logger.debug('debug message');
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('debug message'));
    });
  });

  describe('Logger Instance Methods', () => {
    it('should support per-logger verbosity control', () => {
      const logger = createLogger('test-module');

      // Set verbosity through logger instance
      logger.setVerbosity(VerbosityLevel.WARN);
      expect(getVerbosityLevel()).toBe(VerbosityLevel.WARN);

      logger.log('info message');
      logger.warn('warning message');

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Logger Methods', () => {
    const logger = createLogger('test-module');

    it('should have info() method that works the same as log()', () => {
      setVerbosityLevel(VerbosityLevel.INFO);

      logger.info('info message via info()');
      logger.log('info message via log()');

      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('info message via info()')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('info message via log()'));
    });

    it('info() method should respect verbosity levels', () => {
      setVerbosityLevel(VerbosityLevel.ERROR);
      logger.info('hidden info message');
      expect(consoleLogSpy).not.toHaveBeenCalled();

      setVerbosityLevel(VerbosityLevel.INFO);
      logger.info('visible info message');
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Type Guards and Parsing', () => {
    it('should correctly identify valid verbosity level strings', () => {
      expect(isVerbosityLevel('SILENT')).toBe(true);
      expect(isVerbosityLevel('silent')).toBe(true);
      expect(isVerbosityLevel('ERROR')).toBe(true);
      expect(isVerbosityLevel('error')).toBe(true);
      expect(isVerbosityLevel('WARN')).toBe(true);
      expect(isVerbosityLevel('warn')).toBe(true);
      expect(isVerbosityLevel('INFO')).toBe(true);
      expect(isVerbosityLevel('info')).toBe(true);
      expect(isVerbosityLevel('VERBOSE')).toBe(true);
      expect(isVerbosityLevel('verbose')).toBe(true);
      expect(isVerbosityLevel('DEBUG')).toBe(true);
      expect(isVerbosityLevel('debug')).toBe(true);
    });

    it('should reject invalid verbosity level strings', () => {
      expect(isVerbosityLevel('invalid')).toBe(false);
      expect(isVerbosityLevel('trace')).toBe(false);
      expect(isVerbosityLevel('log')).toBe(false);
      expect(isVerbosityLevel('')).toBe(false);
      expect(isVerbosityLevel('123')).toBe(false);
    });

    it('should parse valid verbosity levels correctly', () => {
      expect(parseVerbosityLevel('silent')).toBe(VerbosityLevel.SILENT);
      expect(parseVerbosityLevel('SILENT')).toBe(VerbosityLevel.SILENT);
      expect(parseVerbosityLevel('error')).toBe(VerbosityLevel.ERROR);
      expect(parseVerbosityLevel('ERROR')).toBe(VerbosityLevel.ERROR);
      expect(parseVerbosityLevel('warn')).toBe(VerbosityLevel.WARN);
      expect(parseVerbosityLevel('WARN')).toBe(VerbosityLevel.WARN);
      expect(parseVerbosityLevel('info')).toBe(VerbosityLevel.INFO);
      expect(parseVerbosityLevel('INFO')).toBe(VerbosityLevel.INFO);
      expect(parseVerbosityLevel('verbose')).toBe(VerbosityLevel.VERBOSE);
      expect(parseVerbosityLevel('VERBOSE')).toBe(VerbosityLevel.VERBOSE);
      expect(parseVerbosityLevel('debug')).toBe(VerbosityLevel.DEBUG);
      expect(parseVerbosityLevel('DEBUG')).toBe(VerbosityLevel.DEBUG);
    });

    it('should return undefined for invalid verbosity levels', () => {
      expect(parseVerbosityLevel('invalid')).toBeUndefined();
      expect(parseVerbosityLevel('trace')).toBeUndefined();
      expect(parseVerbosityLevel('')).toBeUndefined();
    });

    it('should have correct VERBOSITY_MAP structure', () => {
      expect(VERBOSITY_MAP).toEqual({
        silent: VerbosityLevel.SILENT,
        error: VerbosityLevel.ERROR,
        warn: VerbosityLevel.WARN,
        info: VerbosityLevel.INFO,
        verbose: VerbosityLevel.VERBOSE,
        debug: VerbosityLevel.DEBUG,
      });
    });

    it('should parse using VERBOSITY_MAP', () => {
      Object.entries(VERBOSITY_MAP).forEach(([key, value]) => {
        expect(parseVerbosityLevel(key)).toBe(value);
        expect(parseVerbosityLevel(key.toUpperCase())).toBe(value);
      });
    });
  });

  describe('Helper Functions', () => {
    it('isDebugEnabled should return true only for DEBUG level', () => {
      setVerbosityLevel(VerbosityLevel.SILENT);
      expect(isDebugEnabled()).toBe(false);

      setVerbosityLevel(VerbosityLevel.ERROR);
      expect(isDebugEnabled()).toBe(false);

      setVerbosityLevel(VerbosityLevel.WARN);
      expect(isDebugEnabled()).toBe(false);

      setVerbosityLevel(VerbosityLevel.INFO);
      expect(isDebugEnabled()).toBe(false);

      setVerbosityLevel(VerbosityLevel.VERBOSE);
      expect(isDebugEnabled()).toBe(false);

      setVerbosityLevel(VerbosityLevel.DEBUG);
      expect(isDebugEnabled()).toBe(true);
    });

    it('isVerbose should return true for VERBOSE and DEBUG levels', () => {
      setVerbosityLevel(VerbosityLevel.SILENT);
      expect(isVerbose()).toBe(false);

      setVerbosityLevel(VerbosityLevel.ERROR);
      expect(isVerbose()).toBe(false);

      setVerbosityLevel(VerbosityLevel.WARN);
      expect(isVerbose()).toBe(false);

      setVerbosityLevel(VerbosityLevel.INFO);
      expect(isVerbose()).toBe(false);

      setVerbosityLevel(VerbosityLevel.VERBOSE);
      expect(isVerbose()).toBe(true);

      setVerbosityLevel(VerbosityLevel.DEBUG);
      expect(isVerbose()).toBe(true);
    });
  });
});
