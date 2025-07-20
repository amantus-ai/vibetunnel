import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONFIG,
  type QuickStartCommand,
  type VibeTunnelConfig,
} from '../../types/config.js';
import { ConfigService } from './config-service.js';

// Mock modules
vi.mock('fs');
vi.mock('os');
vi.mock('chokidar', () => ({
  watch: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(() => Promise.resolve()),
  })),
}));

// Mock logger to avoid path issues
vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ConfigService', () => {
  let configService: ConfigService;
  const mockHomeDir = '/home/testuser';
  const mockConfigDir = path.join(mockHomeDir, '.vibetunnel');
  const mockConfigPath = path.join(mockConfigDir, 'config.json');

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock os.homedir
    vi.mocked(os.homedir).mockReturnValue(mockHomeDir);

    // Mock fs methods
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.readFileSync).mockImplementation(() => JSON.stringify(DEFAULT_CONFIG));
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

    configService = new ConfigService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor and initialization', () => {
    it('should create config directory if it does not exist', () => {
      expect(vi.mocked(fs.existsSync)).toHaveBeenCalledWith(mockConfigDir);
      expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalledWith(mockConfigDir, { recursive: true });
    });

    it('should load existing config file', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockConfigDir) return true;
        if (p === mockConfigPath) return true;
        return false;
      });

      const customConfig: VibeTunnelConfig = {
        version: 1,
        quickStartCommands: [{ command: 'custom' }],
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(customConfig));

      const service = new ConfigService();
      expect(service.getConfig()).toEqual(customConfig);
    });

    it('should create default config if file does not exist', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockConfigDir) return true;
        if (p === mockConfigPath) return false;
        return false;
      });

      new ConfigService();
      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
        mockConfigPath,
        JSON.stringify(DEFAULT_CONFIG, null, 2),
        'utf8'
      );
    });
  });

  describe('updateQuickStartCommands', () => {
    it('should update quick start commands and save', () => {
      const newCommands: QuickStartCommand[] = [
        { command: 'python3' },
        { name: '🚀 node', command: 'node' },
      ];

      configService.updateQuickStartCommands(newCommands);

      expect(configService.getConfig().quickStartCommands).toEqual(newCommands);
      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
        mockConfigPath,
        JSON.stringify({ ...DEFAULT_CONFIG, quickStartCommands: newCommands }, null, 2),
        'utf8'
      );
    });

    it('should notify config change callbacks', () => {
      const callback = vi.fn();
      configService.onConfigChange(callback);

      const newCommands: QuickStartCommand[] = [{ command: 'test' }];
      configService.updateQuickStartCommands(newCommands);

      expect(callback).toHaveBeenCalledWith({
        ...DEFAULT_CONFIG,
        quickStartCommands: newCommands,
      });
    });

    it('should handle empty commands array', () => {
      configService.updateQuickStartCommands([]);

      expect(configService.getConfig().quickStartCommands).toEqual([]);
      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalled();
    });

    it('should preserve other config properties', () => {
      const initialConfig = configService.getConfig();
      const newCommands: QuickStartCommand[] = [{ command: 'new' }];

      configService.updateQuickStartCommands(newCommands);

      const updatedConfig = configService.getConfig();
      expect(updatedConfig.version).toEqual(initialConfig.version);
      expect(updatedConfig.quickStartCommands).toEqual(newCommands);
    });
  });

  describe('config change notifications', () => {
    it('should register and notify multiple callbacks', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      configService.onConfigChange(callback1);
      configService.onConfigChange(callback2);

      configService.updateQuickStartCommands([{ command: 'test' }]);

      expect(callback1).toHaveBeenCalledOnce();
      expect(callback2).toHaveBeenCalledOnce();
    });

    it('should allow unsubscribing from changes', () => {
      const callback = vi.fn();
      const unsubscribe = configService.onConfigChange(callback);

      unsubscribe();
      configService.updateQuickStartCommands([{ command: 'test' }]);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle callback errors gracefully', () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Callback error');
      });
      const normalCallback = vi.fn();

      configService.onConfigChange(errorCallback);
      configService.onConfigChange(normalCallback);

      // Should not throw
      expect(() => {
        configService.updateQuickStartCommands([{ command: 'test' }]);
      }).not.toThrow();

      expect(errorCallback).toHaveBeenCalled();
      expect(normalCallback).toHaveBeenCalled();
    });
  });

  describe('file system error handling', () => {
    it('should handle directory creation errors', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      // Should not throw during construction
      expect(() => new ConfigService()).not.toThrow();
    });

    it('should handle config save errors', () => {
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error('Disk full');
      });

      // Should not throw
      expect(() => {
        configService.updateQuickStartCommands([{ command: 'test' }]);
      }).not.toThrow();

      // Config should still be updated in memory
      expect(configService.getConfig().quickStartCommands).toEqual([{ command: 'test' }]);
    });

    it('should handle corrupted config file', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockConfigDir) return true;
        if (p === mockConfigPath) return true;
        return false;
      });
      vi.mocked(fs.readFileSync).mockReturnValue('{ invalid json');

      const service = new ConfigService();

      // Should fall back to defaults
      expect(service.getConfig()).toEqual(DEFAULT_CONFIG);
    });
  });

  describe('getConfigPath', () => {
    it('should return the correct config path', () => {
      expect(configService.getConfigPath()).toBe(mockConfigPath);
    });
  });
});
