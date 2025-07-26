/**
 * Server Configuration Service
 *
 * Centralized service for managing server configuration including:
 * - Quick start commands
 * - Repository base path
 * - Server configuration status
 */
import { DEFAULT_REPOSITORY_BASE_PATH } from '../../shared/constants.js';
import { HttpMethod } from '../../shared/types.js';
import type { NotificationPreferences, QuickStartCommand } from '../../types/config.js';
import { createLogger } from '../utils/logger.js';
import type { AuthClient } from './auth-client.js';

const logger = createLogger('server-config-service');

export interface ServerConfig {
  repositoryBasePath: string;
  serverConfigured?: boolean;
  quickStartCommands?: QuickStartCommand[];
  notificationPreferences?: NotificationPreferences;
}

export class ServerConfigService {
  private authClient?: AuthClient;
  private configCache?: ServerConfig;
  private cacheTimestamp?: number;
  private readonly CACHE_TTL = 60000; // 1 minute cache

  constructor(authClient?: AuthClient) {
    this.authClient = authClient;
  }

  /**
   * Set or update the auth client
   */
  setAuthClient(authClient: AuthClient): void {
    this.authClient = authClient;
    // Clear cache when auth changes
    this.clearCache();
  }

  /**
   * Clear the config cache
   */
  private clearCache(): void {
    this.configCache = undefined;
    this.cacheTimestamp = undefined;
  }

  /**
   * Check if cache is still valid
   */
  private isCacheValid(): boolean {
    if (!this.configCache || !this.cacheTimestamp) {
      return false;
    }
    return Date.now() - this.cacheTimestamp < this.CACHE_TTL;
  }

  /**
   * Load server configuration
   * @param forceRefresh - Force refresh even if cache is valid
   */
  async loadConfig(forceRefresh = false): Promise<ServerConfig> {
    // Return cached config if valid and not forcing refresh
    if (!forceRefresh && this.isCacheValid() && this.configCache) {
      logger.debug('Returning cached server config');
      return this.configCache;
    }

    try {
      const response = await fetch('/api/config', {
        headers: this.authClient ? this.authClient.getAuthHeader() : {},
      });

      if (!response.ok) {
        throw new Error(`Failed to load config: ${response.statusText}`);
      }

      const config: ServerConfig = await response.json();

      // Update cache
      this.configCache = config;
      this.cacheTimestamp = Date.now();

      logger.debug('Loaded server config:', config);
      return config;
    } catch (error) {
      logger.error('Failed to load server config:', error);
      // Return default config on error
      return {
        repositoryBasePath: DEFAULT_REPOSITORY_BASE_PATH,
        serverConfigured: false,
        quickStartCommands: [],
      };
    }
  }

  /**
   * Update quick start commands
   */
  async updateQuickStartCommands(commands: QuickStartCommand[]): Promise<void> {
    if (!commands || !Array.isArray(commands)) {
      throw new Error('Invalid quick start commands');
    }

    // Validate commands
    const validCommands = commands.filter(
      (cmd) => cmd && typeof cmd.command === 'string' && cmd.command.trim()
    );

    try {
      const response = await fetch('/api/config', {
        method: HttpMethod.PUT,
        headers: {
          'Content-Type': 'application/json',
          ...(this.authClient ? this.authClient.getAuthHeader() : {}),
        },
        body: JSON.stringify({ quickStartCommands: validCommands }),
      });

      if (!response.ok) {
        throw new Error(`Failed to update config: ${response.statusText}`);
      }

      // Clear cache to force reload on next access
      this.clearCache();

      logger.debug('Updated quick start commands:', validCommands);
    } catch (error) {
      logger.error('Failed to update quick start commands:', error);
      throw error;
    }
  }

  /**
   * Get repository base path from config
   */
  async getRepositoryBasePath(): Promise<string> {
    const config = await this.loadConfig();
    return config.repositoryBasePath || DEFAULT_REPOSITORY_BASE_PATH;
  }

  /**
   * Check if server is configured (Mac app connected)
   */
  async isServerConfigured(): Promise<boolean> {
    const config = await this.loadConfig();
    return config.serverConfigured ?? false;
  }

  /**
   * Get quick start commands
   */
  async getQuickStartCommands(): Promise<QuickStartCommand[]> {
    const config = await this.loadConfig();
    return config.quickStartCommands || [];
  }

  /**
   * Update configuration (supports partial updates)
   */
  async updateConfig(updates: Partial<ServerConfig>): Promise<void> {
    if (!updates || typeof updates !== 'object') {
      throw new Error('Invalid configuration updates');
    }

    try {
      const response = await fetch('/api/config', {
        method: HttpMethod.PUT,
        headers: {
          'Content-Type': 'application/json',
          ...(this.authClient ? this.authClient.getAuthHeader() : {}),
        },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error(`Failed to update config: ${response.statusText}`);
      }

      // Clear cache to force reload on next access
      this.clearCache();

      logger.debug('Updated server config:', updates);
    } catch (error) {
      logger.error('Failed to update server config:', error);
      throw error;
    }
  }

  /**
   * Get notification preferences
   */
  async getNotificationPreferences(): Promise<ServerConfig['notificationPreferences']> {
    const config = await this.loadConfig();
    return config.notificationPreferences;
  }

  /**
   * Update notification preferences
   */
  async updateNotificationPreferences(preferences: NotificationPreferences): Promise<void> {
    await this.updateConfig({ notificationPreferences: preferences });
  }
}

// Export singleton instance for easy access
export const serverConfigService = new ServerConfigService();
