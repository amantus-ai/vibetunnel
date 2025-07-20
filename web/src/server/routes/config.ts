import { Router } from 'express';
import type { QuickStartCommand } from '../../types/config.js';
import type { ConfigService } from '../services/config-service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('config');

export interface AppConfig {
  repositoryBasePath: string;
  serverConfigured?: boolean;
  quickStartCommands?: QuickStartCommand[];
}

interface ConfigRouteOptions {
  getRepositoryBasePath: () => string | null;
  configService: ConfigService;
}

/**
 * Create routes for application configuration
 */
export function createConfigRoutes(options: ConfigRouteOptions): Router {
  const router = Router();
  const { getRepositoryBasePath, configService } = options;

  /**
   * Get application configuration
   * GET /api/config
   */
  router.get('/config', (_req, res) => {
    try {
      const repositoryBasePath = getRepositoryBasePath();
      const vibeTunnelConfig = configService.getConfig();

      const config: AppConfig = {
        repositoryBasePath: repositoryBasePath || '~/',
        serverConfigured: repositoryBasePath !== null,
        quickStartCommands: vibeTunnelConfig.quickStartCommands,
      };

      logger.debug('[GET /api/config] Returning app config:', config);
      res.json(config);
    } catch (error) {
      logger.error('[GET /api/config] Error getting app config:', error);
      res.status(500).json({ error: 'Failed to get app config' });
    }
  });

  /**
   * Update application configuration
   * PUT /api/config
   */
  router.put('/config', (req, res) => {
    try {
      const { quickStartCommands } = req.body;

      if (quickStartCommands && Array.isArray(quickStartCommands)) {
        // Validate commands
        const validCommands = quickStartCommands.filter(
          (cmd: QuickStartCommand) => cmd && typeof cmd.command === 'string' && cmd.command.trim()
        );

        // Update config
        configService.updateQuickStartCommands(validCommands);

        logger.debug('[PUT /api/config] Updated quick start commands:', validCommands);
        res.json({ success: true, quickStartCommands: validCommands });
      } else {
        res.status(400).json({ error: 'Invalid quick start commands' });
      }
    } catch (error) {
      logger.error('[PUT /api/config] Error updating config:', error);
      res.status(500).json({ error: 'Failed to update config' });
    }
  });

  return router;
}
