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
  configService: ConfigService;
}

/**
 * Create routes for application configuration
 */
export function createConfigRoutes(options: ConfigRouteOptions): Router {
  const router = Router();
  const { configService } = options;

  /**
   * Get application configuration
   * GET /api/config
   */
  router.get('/config', (_req, res) => {
    try {
      const vibeTunnelConfig = configService.getConfig();
      const repositoryBasePath = vibeTunnelConfig.repositoryBasePath || '~/';

      const config: AppConfig = {
        repositoryBasePath: repositoryBasePath,
        serverConfigured: true, // Always configured when server is running
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
      const { quickStartCommands, repositoryBasePath } = req.body;
      const updates: { [key: string]: unknown } = {};

      if (quickStartCommands && Array.isArray(quickStartCommands)) {
        // Validate commands
        const validCommands = quickStartCommands.filter(
          (cmd: QuickStartCommand) => cmd && typeof cmd.command === 'string' && cmd.command.trim()
        );

        // Update config
        configService.updateQuickStartCommands(validCommands);
        updates.quickStartCommands = validCommands;
        logger.debug('[PUT /api/config] Updated quick start commands:', validCommands);
      }

      if (repositoryBasePath && typeof repositoryBasePath === 'string') {
        // Update repository base path
        configService.updateRepositoryBasePath(repositoryBasePath);
        updates.repositoryBasePath = repositoryBasePath;
        logger.debug('[PUT /api/config] Updated repository base path:', repositoryBasePath);
      }

      if (Object.keys(updates).length > 0) {
        res.json({ success: true, ...updates });
      } else {
        res.status(400).json({ error: 'No valid updates provided' });
      }
    } catch (error) {
      logger.error('[PUT /api/config] Error updating config:', error);
      res.status(500).json({ error: 'Failed to update config' });
    }
  });

  return router;
}
