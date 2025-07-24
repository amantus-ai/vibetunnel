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

  /**
   * Creates a new RepositoryService instance
   *
   * @param authClient - Authentication client for API requests
   * @param serverConfigService - Service for accessing server configuration
   */
  constructor(authClient: AuthClient, serverConfigService: ServerConfigService) {
    this.authClient = authClient;
    this.serverConfigService = serverConfigService;
  }

  /**
   * Discovers Git repositories in the configured base path
   *
   * Scans the directory tree starting from the server-configured repository base path
   * to find all Git repositories. The scan is recursive and identifies directories
   * containing a `.git` subdirectory.
   *
   * The discovery process:
   * 1. Retrieves the base path from server configuration
   * 2. Makes an authenticated API request to scan for repositories
   * 3. Returns repository metadata including name, path, and last modified time
   *
   * @returns Promise resolving to an array of discovered repositories
   *          Returns empty array if discovery fails or no repositories found
   *
   * @throws Never throws - errors are logged and empty array returned
   *
   * @example
   * ```typescript
   * const repoService = new RepositoryService(authClient, serverConfig);
   *
   * // Discover all repositories
   * const repos = await repoService.discoverRepositories();
   *
   * // Use in autocomplete
   * repos.forEach(repo => {
   *   console.log(`Found: ${repo.name} at ${repo.path}`);
   *   console.log(`Last modified: ${new Date(repo.lastModified)}`);
   * });
   *
   * // Handle empty results
   * if (repos.length === 0) {
   *   console.log('No repositories found or discovery failed');
   * }
   * ```
   *
   * @see web/src/server/routes/repositories.ts:15 - Server endpoint implementation
   * @see web/src/server/services/file-system.service.ts - Underlying directory scanning
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
