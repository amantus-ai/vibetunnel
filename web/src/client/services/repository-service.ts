import type { Repository } from '../components/autocomplete-manager.js';
import { createLogger } from '../utils/logger.js';
import type { AuthClient } from './auth-client.js';
import type { ServerConfigService } from './server-config-service.js';

const logger = createLogger('repository-service');

/**
 * Service for discovering and managing Git repositories in the filesystem.
 *
 * Provides repository discovery functionality by scanning directories for Git
 * repositories. Works in conjunction with the server's file system access to
 * locate repositories based on configured base paths.
 *
 * Features:
 * - Discovers Git repositories recursively from a base path
 * - Retrieves repository metadata (name, path, last modified)
 * - Integrates with server configuration for base path settings
 * - Supports authenticated API requests
 *
 * @example
 * ```typescript
 * const repoService = new RepositoryService(authClient, serverConfig);
 * const repos = await repoService.discoverRepositories();
 * // Returns array of Repository objects with folder info
 * ```
 *
 * @see AutocompleteManager - Consumes repository data for UI autocomplete
 * @see web/src/server/routes/repositories.ts - Server-side repository discovery
 * @see ServerConfigService - Provides repository base path configuration
 */
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
