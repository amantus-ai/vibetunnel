import { Router } from 'express';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('config');

export interface AppConfig {
  repositoryBasePath: string;
  serverConfigured?: boolean;
}

interface ConfigRouteOptions {
  getRepositoryBasePath: () => string | null;
}

/**
 * Create routes for application configuration
 */
export function createConfigRoutes(options: ConfigRouteOptions): Router {
  const router = Router();
  const { getRepositoryBasePath } = options;

  /**
   * Get application configuration
   * GET /api/config
   */
  router.get('/config', (_req, res) => {
    try {
      const repositoryBasePath = getRepositoryBasePath();
      const config: AppConfig = {
        repositoryBasePath: repositoryBasePath || '~/',
        serverConfigured: repositoryBasePath !== null,
      };

      logger.debug('[GET /api/config] Returning app config:', config);
      res.json(config);
    } catch (error) {
      logger.error('[GET /api/config] Error getting app config:', error);
      res.status(500).json({ error: 'Failed to get app config' });
    }
  });

  return router;
}
