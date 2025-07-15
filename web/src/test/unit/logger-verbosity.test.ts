import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VerbosityLevel,
  createLogger,
  getVerbosityLevel,
  initLogger,
  setVerbosityLevel,
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
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('error message')
      );
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
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('debug message')
      );
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
});