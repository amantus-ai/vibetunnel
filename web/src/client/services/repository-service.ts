import type { Repository } from '../components/autocomplete-manager.js';
import { createLogger } from '../utils/logger.js';
import type { AuthClient } from './auth-client.js';
import type { ServerConfigService } from './server-config-service.js';

const logger = createLogger('repository-service');

export class RepositoryService {
  private authClient: AuthClient;
  private serverConfigService: ServerConfigService;

  constructor(authClient: AuthClient, serverConfigService: ServerConfigService) {
    this.authClient = authClient;
    this.serverConfigService = serverConfigService;
  }

  /**
   * Discovers git repositories in the configured base path
   * @returns Promise with discovered repositories
   */
  async discoverRepositories(): Promise<Repository[]> {
    try {
      // Get repository base path from server config
      const basePath = await this.serverConfigService.getRepositoryBasePath();

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
}
