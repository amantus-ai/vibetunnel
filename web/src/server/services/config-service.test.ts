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

    it('should validate config and use defaults on invalid structure', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockConfigDir) return true;
        if (p === mockConfigPath) return true;
        return false;
      });

      // Invalid config - missing version
      const invalidConfig = {
        quickStartCommands: [{ command: 'test' }],
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(invalidConfig));

      const service = new ConfigService();

      // Should fall back to defaults and save them
      expect(service.getConfig()).toEqual(DEFAULT_CONFIG);
      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
        mockConfigPath,
        JSON.stringify(DEFAULT_CONFIG, null, 2),
        'utf8'
      );
    });

    it('should validate config and reject empty commands', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockConfigDir) return true;
        if (p === mockConfigPath) return true;
        return false;
      });

      // Invalid config - empty command
      const invalidConfig: VibeTunnelConfig = {
        version: 1,
        quickStartCommands: [{ command: '' }],
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(invalidConfig));

      const service = new ConfigService();

      // Should fall back to defaults
      expect(service.getConfig()).toEqual(DEFAULT_CONFIG);
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

    it('should reject commands with empty strings', () => {
      const invalidCommands: QuickStartCommand[] = [
        { command: 'valid' },
        { command: '' }, // Invalid empty command
      ];

      expect(() => {
        configService.updateQuickStartCommands(invalidCommands);
      }).toThrow('Invalid config');

      // Config should remain unchanged
      expect(configService.getConfig()).toEqual(DEFAULT_CONFIG);
    });

    it('should accept commands with optional names', () => {
      const commandsWithNames: QuickStartCommand[] = [
        { name: '✨ Special', command: 'special-cmd' },
        { command: 'no-name-cmd' }, // No name is valid
        { name: '', command: 'empty-name-cmd' }, // Empty name is valid
      ];

      configService.updateQuickStartCommands(commandsWithNames);
      expect(configService.getConfig().quickStartCommands).toEqual(commandsWithNames);
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

      // Should throw with proper error message
      expect(() => {
        configService.updateQuickStartCommands([{ command: 'test' }]);
      }).toThrow('Failed to save configuration: Disk full');

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

  describe('updateConfig', () => {
    it('should update entire config and validate', () => {
      const newConfig: VibeTunnelConfig = {
        version: 2,
        quickStartCommands: [{ command: 'python3' }, { name: 'Node.js', command: 'node' }],
      };

      configService.updateConfig(newConfig);

      expect(configService.getConfig()).toEqual(newConfig);
      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
        mockConfigPath,
        JSON.stringify(newConfig, null, 2),
        'utf8'
      );
    });

    it('should reject invalid config structure', () => {
      const invalidConfig = {
        version: 'not-a-number', // Should be number
        quickStartCommands: [{ command: 'test' }],
      } as unknown as VibeTunnelConfig;

      expect(() => {
        configService.updateConfig(invalidConfig);
      }).toThrow('Invalid config');

      // Config should remain unchanged
      expect(configService.getConfig()).toEqual(DEFAULT_CONFIG);
    });

    it('should reject config with invalid command structure', () => {
      const invalidConfig = {
        version: 1,
        quickStartCommands: [
          { command: 'valid' },
          { notACommand: 'invalid' }, // Missing required 'command' field
        ],
      } as unknown as VibeTunnelConfig;

      expect(() => {
        configService.updateConfig(invalidConfig);
      }).toThrow('Invalid config');
    });

    it('should reject config with non-array quickStartCommands', () => {
      const invalidConfig = {
        version: 1,
        quickStartCommands: 'not-an-array',
      } as unknown as VibeTunnelConfig;

      expect(() => {
        configService.updateConfig(invalidConfig);
      }).toThrow('Invalid config');
    });
  });

  describe('validation edge cases', () => {
    it('should handle config with extra properties', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === mockConfigDir) return true;
        if (p === mockConfigPath) return true;
        return false;
      });

      // Config with extra properties (should be stripped)
      const configWithExtras = {
        version: 1,
        quickStartCommands: [{ command: 'test' }],
        extraProperty: 'should be ignored',
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(configWithExtras));

      const service = new ConfigService();
      const config = service.getConfig();

      // Should only have valid properties
      expect(config).toEqual({
        version: 1,
        quickStartCommands: [{ command: 'test' }],
      });
      expect('extraProperty' in config).toBe(false);
    });

    it('should handle commands with extra properties', () => {
      const commandsWithExtras = [
        {
          command: 'valid',
          name: 'Valid Command',
          extraProp: 'ignored', // Should be stripped
        },
      ] as Array<QuickStartCommand & { extraProp: string }>;

      configService.updateQuickStartCommands(commandsWithExtras);
      const saved = configService.getConfig().quickStartCommands;

      // Extra properties should be stripped
      expect(saved).toEqual([{ command: 'valid', name: 'Valid Command' }]);
    });

    it('should handle very long command strings', () => {
      const longCommand = 'a'.repeat(1000); // 1000 character command
      const commands: QuickStartCommand[] = [{ command: longCommand }];

      // Should accept long commands (no max length)
      configService.updateQuickStartCommands(commands);
      expect(configService.getConfig().quickStartCommands[0].command).toBe(longCommand);
    });

    it('should handle unicode in commands and names', () => {
      const unicodeCommands: QuickStartCommand[] = [
        { name: '🚀 火箭', command: 'echo "Hello 世界"' },
        { name: 'émojis 😀', command: 'café' },
      ];

      configService.updateQuickStartCommands(unicodeCommands);
      expect(configService.getConfig().quickStartCommands).toEqual(unicodeCommands);
    });
  });

  describe('notification preferences', () => {
    it('should return default notification preferences when no preferences are set', () => {
      const preferences = configService.getNotificationPreferences();
      // Should return DEFAULT_NOTIFICATION_PREFERENCES instead of undefined
      expect(preferences).toEqual({
        enabled: true,
        sessionStart: true,
        sessionExit: true,
        commandCompletion: true,
        commandError: true,
        bell: true,
        claudeTurn: false,
        soundEnabled: true,
        vibrationEnabled: true,
      });
    });

    it('should update notification preferences', () => {
      const newPreferences = {
        enabled: true,
        sessionStart: false,
        sessionExit: true,
        commandCompletion: true,
        commandError: true,
        bell: true,
        claudeTurn: false,
        soundEnabled: true,
        vibrationEnabled: false,
      };

      configService.updateNotificationPreferences(newPreferences);

      const savedPreferences = configService.getNotificationPreferences();
      expect(savedPreferences).toEqual(newPreferences);
    });

    it('should support partial notification preference updates', () => {
      // First set some initial preferences
      const initialPreferences = {
        enabled: true,
        sessionStart: true,
        sessionExit: true,
        commandCompletion: true,
        commandError: true,
        bell: true,
        claudeTurn: false,
        soundEnabled: true,
        vibrationEnabled: true,
      };
      configService.updateNotificationPreferences(initialPreferences);

      // Now update only some fields
      const partialUpdate = {
        enabled: false,
        sessionStart: false,
      };
      configService.updateNotificationPreferences(partialUpdate);

      const savedPreferences = configService.getNotificationPreferences();
      expect(savedPreferences).toEqual({
        ...initialPreferences,
        ...partialUpdate,
      });
    });

    it('should save notification preferences to file', () => {
      const preferences = {
        enabled: false,
        sessionStart: true,
        sessionExit: false,
        commandCompletion: false,
        commandError: false,
        bell: false,
        claudeTurn: true,
        soundEnabled: true,
        vibrationEnabled: true,
      };

      configService.updateNotificationPreferences(preferences);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        mockConfigPath,
        expect.stringContaining('"notifications"'),
        'utf8'
      );

      // Verify the saved config includes preferences (get the last write call)
      const writeCalls = vi
        .mocked(fs.writeFileSync)
        .mock.calls.filter((call) => call[0] === mockConfigPath);
      const lastWriteCall = writeCalls[writeCalls.length - 1];
      const savedConfig = JSON.parse(lastWriteCall?.[1] as string);
      expect(savedConfig.preferences?.notifications).toEqual(preferences);
    });

    it('should notify listeners when preferences change', () => {
      const callback = vi.fn();
      configService.onConfigChange(callback);

      const preferences = {
        enabled: true,
        sessionStart: true,
        sessionExit: true,
        commandCompletion: true,
        commandError: true,
        bell: true,
        claudeTurn: false,
        soundEnabled: false,
        vibrationEnabled: true,
      };

      configService.updateNotificationPreferences(preferences);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({
            notifications: preferences,
          }),
        })
      );
    });

    it('should create preferences object if it does not exist', () => {
      // Start with a config without preferences
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          version: 2,
          quickStartCommands: [],
        })
      );

      const service = new ConfigService();
      const preferences = {
        enabled: true,
        sessionStart: false,
        sessionExit: true,
        commandCompletion: true,
        commandError: true,
        bell: true,
        claudeTurn: false,
        soundEnabled: false,
        vibrationEnabled: false,
      };

      service.updateNotificationPreferences(preferences);

      const config = service.getConfig();
      expect(config.preferences).toBeDefined();
      expect(config.preferences?.notifications).toEqual(preferences);
    });
  });
});
