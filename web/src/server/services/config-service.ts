import type { FSWatcher } from 'chokidar';
import { watch } from 'chokidar';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_CONFIG, type VibeTunnelConfig } from '../../types/config.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('config-service');

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

  private loadConfig(): void {
    try {
      this.ensureConfigDir();

      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        const parsedConfig = JSON.parse(data) as VibeTunnelConfig;

        // Validate config structure
        if (parsedConfig.version && Array.isArray(parsedConfig.quickStartCommands)) {
          this.config = parsedConfig;
          logger.info('Loaded configuration from disk');
        } else {
          logger.warn('Invalid config structure, using defaults');
          this.saveConfig(); // Save defaults
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
    this.config = config;
    this.saveConfig();
    this.notifyConfigChange();
  }

  public updateQuickStartCommands(commands: VibeTunnelConfig['quickStartCommands']): void {
    this.config.quickStartCommands = commands;
    this.saveConfig();
    this.notifyConfigChange();
  }

  public getConfigPath(): string {
    return this.configPath;
  }
}
