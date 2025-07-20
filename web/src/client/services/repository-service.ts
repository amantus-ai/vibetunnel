import type { Repository } from '../components/autocomplete-manager.js';
import {
  STORAGE_KEY as APP_PREFERENCES_STORAGE_KEY,
  type AppPreferences,
} from '../components/unified-settings.js';
import { createLogger } from '../utils/logger.js';
import type { AuthClient } from './auth-client.js';

const logger = createLogger('repository-service');

export class RepositoryService {
  private authClient: AuthClient;

  constructor(authClient: AuthClient) {
    this.authClient = authClient;
  }

  /**
   * Discovers git repositories in the configured base path
   * @returns Promise with discovered repositories
   */
  async discoverRepositories(): Promise<Repository[]> {
    // Get app preferences to read repositoryBasePath
    const basePath = this.getRepositoryBasePath();

    try {
      const response = await fetch(
        `/api/repositories/discover?path=${encodeURIComponent(basePath)}`,
        {
          headers: this.authClient.getAuthHeader(),
        }
      );

      if (response.ok) {
        const repositories = await response.json();
        logger.debug(`Discovered ${repositories.length} repositories`);
        return repositories;
      } else {
        logger.error('Failed to discover repositories');
        return [];
      }
    } catch (error) {
      logger.error('Error discovering repositories:', error);
      return [];
    }
  }

  /**
   * Gets the repository base path from app preferences
   * @returns The base path or default '~/'
   */
  private getRepositoryBasePath(): string {
    const savedPreferences = localStorage.getItem(APP_PREFERENCES_STORAGE_KEY);

    if (savedPreferences) {
      try {
        const preferences: AppPreferences = JSON.parse(savedPreferences);
        return preferences.repositoryBasePath || '~/';
      } catch (error) {
        logger.error('Failed to parse app preferences:', error);
      }
    }

    return '~/';
  }
}
