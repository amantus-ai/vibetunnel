import type { FSWatcher } from 'chokidar';
import { watch } from 'chokidar';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { DEFAULT_CONFIG, type VibeTunnelConfig } from '../../types/config.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('config-service');

// Zod schema for config validation
const ConfigSchema = z.object({
  version: z.number(),
  quickStartCommands: z.array(
    z.object({
      name: z.string().optional(),
      command: z.string().min(1, 'Command cannot be empty'),
    })
  ),
  repositoryBasePath: z.string().optional(),
});

/**
 * Service for managing VibeTunnel configuration with file persistence and live reloading.
 *
 * The ConfigService handles loading, saving, and watching the VibeTunnel configuration file
 * stored in the user's home directory at `~/.vibetunnel/config.json`. It provides validation
 * using Zod schemas, automatic file watching for live reloading, and event-based notifications
 * when configuration changes occur.
 *
 * Key features:
 * - Persistent storage in user's home directory
 * - Automatic validation with Zod schemas
 * - Live reloading with file watching
 * - Event-based change notifications
 * - Graceful fallback to defaults on errors
 * - Atomic updates with validation
 *
 * @example
 * ```typescript
 * // Create and start the config service
 * const configService = new ConfigService();
 * configService.startWatching();
 *
 * // Subscribe to configuration changes
 * const unsubscribe = configService.onConfigChange((newConfig) => {
 *   console.log('Config updated:', newConfig);
 * });
 *
 * // Update quick start commands
 * configService.updateQuickStartCommands([
 *   { name: '🚀 dev', command: 'npm run dev' },
 *   { command: 'bash' }
 * ]);
 *
 * // Get current configuration
 * const config = configService.getConfig();
 *
 * // Clean up when done
 * unsubscribe();
 * configService.stopWatching();
 * ```
 */
export class ConfigService {
  private configDir: string;
  private configPath: string;
  private config: VibeTunnelConfig = DEFAULT_CONFIG;
  private watcher?: FSWatcher;
  private configChangeCallbacks: Set<(config: VibeTunnelConfig) => void> = new Set();

  constructor() {
    this.configDir = path.join(os.homedir(), '.vibetunnel');
    this.configPath = path.join(this.configDir, 'config.json');
    this.loadConfig();
  }

  private ensureConfigDir(): void {
    try {
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true });
        logger.info(`Created config directory: ${this.configDir}`);
      }
    } catch (error) {
      logger.error('Failed to create config directory:', error);
    }
  }

  private validateConfig(data: unknown): VibeTunnelConfig {
    try {
      return ConfigSchema.parse(data);
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error('Config validation failed:', error.issues);
        throw new Error(`Invalid config: ${error.issues.map((e) => e.message).join(', ')}`);
      }
      throw error;
    }
  }

  private loadConfig(): void {
    try {
      this.ensureConfigDir();

      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        const parsedData = JSON.parse(data);

        try {
          // Validate config using Zod schema
          this.config = this.validateConfig(parsedData);
          logger.info('Loaded and validated configuration from disk');
        } catch (validationError) {
          logger.warn('Config validation failed, using defaults:', validationError);
          this.config = DEFAULT_CONFIG;
          this.saveConfig(); // Save defaults to fix invalid config
        }
      } else {
        logger.info('No config file found, creating with defaults');
        this.saveConfig(); // Create config with defaults
      }
    } catch (error) {
      logger.error('Failed to load config:', error);
      // Keep using defaults
    }
  }

  private saveConfig(): void {
    try {
      this.ensureConfigDir();
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
      logger.info('Saved configuration to disk');
    } catch (error) {
      logger.error('Failed to save config:', error);
    }
  }

  public startWatching(): void {
    if (this.watcher) {
      return; // Already watching
    }

    try {
      this.watcher = watch(this.configPath, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 500,
          pollInterval: 100,
        },
      });

      this.watcher.on('change', () => {
        logger.info('Configuration file changed, reloading...');
        const oldConfig = JSON.stringify(this.config);
        this.loadConfig();

        // Only notify if config actually changed
        if (JSON.stringify(this.config) !== oldConfig) {
          this.notifyConfigChange();
        }
      });

      this.watcher.on('error', (error) => {
        logger.error('Config watcher error:', error);
      });

      logger.info('Started watching configuration file');
    } catch (error) {
      logger.error('Failed to start config watcher:', error);
    }
  }

  public stopWatching(): void {
    if (this.watcher) {
      this.watcher.close().catch((error) => {
        logger.error('Error closing config watcher:', error);
      });
      this.watcher = undefined;
      logger.info('Stopped watching configuration file');
    }
  }

  private notifyConfigChange(): void {
    for (const callback of this.configChangeCallbacks) {
      try {
        callback(this.config);
      } catch (error) {
        logger.error('Error in config change callback:', error);
      }
    }
  }

  public onConfigChange(callback: (config: VibeTunnelConfig) => void): () => void {
    this.configChangeCallbacks.add(callback);
    // Return unsubscribe function
    return () => {
      this.configChangeCallbacks.delete(callback);
    };
  }

  public getConfig(): VibeTunnelConfig {
    return this.config;
  }

  public updateConfig(config: VibeTunnelConfig): void {
    // Validate the config before updating
    this.config = this.validateConfig(config);
    this.saveConfig();
    this.notifyConfigChange();
  }

  public updateQuickStartCommands(commands: VibeTunnelConfig['quickStartCommands']): void {
    // Validate the entire config with updated commands
    const updatedConfig = { ...this.config, quickStartCommands: commands };
    this.config = this.validateConfig(updatedConfig);
    this.saveConfig();
    this.notifyConfigChange();
  }

  public updateRepositoryBasePath(path: string): void {
    // Validate the entire config with updated repository base path
    const updatedConfig = { ...this.config, repositoryBasePath: path };
    this.config = this.validateConfig(updatedConfig);
    this.saveConfig();
    this.notifyConfigChange();
  }

  public getConfigPath(): string {
    return this.configPath;
  }
}
