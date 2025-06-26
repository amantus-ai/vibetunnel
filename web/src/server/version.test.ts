import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILD_DATE, GIT_COMMIT, getVersionInfo, printVersionBanner, VERSION } from './version';

describe('version', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getVersionInfo', () => {
    it('should return version information', () => {
      const info = getVersionInfo();

      expect(info).toHaveProperty('version');
      expect(info).toHaveProperty('buildDate');
      expect(info).toHaveProperty('buildTimestamp');
      expect(info).toHaveProperty('gitCommit');
      expect(info).toHaveProperty('nodeVersion');
      expect(info).toHaveProperty('platform');
      expect(info).toHaveProperty('arch');
      expect(info).toHaveProperty('uptime');
      expect(info).toHaveProperty('pid');

      expect(info.version).toBe(VERSION);
      expect(info.platform).toBe(process.platform);
      expect(info.arch).toBe(process.arch);
      expect(info.nodeVersion).toBe(process.version);
      expect(info.pid).toBe(process.pid);
      expect(typeof info.uptime).toBe('number');
    });

    it('should return proper types for all fields', () => {
      const info = getVersionInfo();

      expect(typeof info.version).toBe('string');
      expect(typeof info.buildDate).toBe('string');
      expect(typeof info.nodeVersion).toBe('string');
      expect(typeof info.platform).toBe('string');
      expect(typeof info.arch).toBe('string');
      expect(typeof info.gitCommit).toBe('string');
      expect(typeof info.uptime).toBe('number');
      expect(typeof info.pid).toBe('number');
    });
  });

  describe('constants', () => {
    it('should have expected version format', () => {
      expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-\w+(\.\d+)?)?$/);
    });

    it('should have defaults for git commit', () => {
      // When running in test/dev, GIT_COMMIT should default to 'development'
      expect(GIT_COMMIT).toBeTruthy();
      // BUILD_DATE should always have a value
      expect(BUILD_DATE).toBeTruthy();
    });
  });

  describe('printVersionBanner', () => {
    it('should not throw when called', () => {
      expect(() => printVersionBanner()).not.toThrow();
    });
  });
});
