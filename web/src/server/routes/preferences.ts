import { type Request, type Response, Router } from 'express';
import type { PushNotificationPreferences } from '../../shared/types.js';
import type { ConfigService } from '../services/config-service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('preferences');

// Default preferences matching the macOS app defaults
const DEFAULT_PREFERENCES: PushNotificationPreferences = {
  enabled: true,
  sessionExit: true,
  sessionStart: true,
  sessionError: true,
  commandNotifications: true,
  systemAlerts: true,
  soundEnabled: true,
  vibrationEnabled: true,
};

/**
 * API routes for managing notification preferences
 * These preferences are now stored in config.json via ConfigService
 */
export function createPreferencesRouter(configService: ConfigService): Router {
  const router = Router();

  // Get notification preferences
  router.get('/preferences/notifications', async (_req: Request, res: Response) => {
    try {
      // Get preferences from config.json
      const notifConfig = configService.getNotificationPreferences();

      if (notifConfig) {
        // Map from config format to API format
        const preferences: PushNotificationPreferences = {
          enabled: notifConfig.enabled,
          sessionExit: notifConfig.sessionExit,
          sessionStart: notifConfig.sessionStart,
          sessionError: notifConfig.commandError,
          commandNotifications: notifConfig.commandCompletion,
          systemAlerts: notifConfig.bell,
          claudeTurn: notifConfig.claudeTurn ?? false,
          soundEnabled: true,
          vibrationEnabled: false,
        };
        res.json(preferences);
      } else {
        // No preferences in config yet, return defaults
        logger.debug('No notification preferences in config, returning defaults');
        res.json(DEFAULT_PREFERENCES);
      }
    } catch (error) {
      logger.error('Failed to get preferences:', error);
      res.status(500).json({ error: 'Failed to get preferences' });
    }
  });

  // Update notification preferences
  router.put('/preferences/notifications', async (req: Request, res: Response) => {
    try {
      const preferences = req.body as Partial<PushNotificationPreferences>;

      // Get existing preferences from config
      const existingConfig = configService.getNotificationPreferences();

      // Map API format to config format
      const notificationConfig = {
        enabled: preferences.enabled ?? existingConfig?.enabled ?? true,
        sessionStart: preferences.sessionStart ?? existingConfig?.sessionStart ?? true,
        sessionExit: preferences.sessionExit ?? existingConfig?.sessionExit ?? true,
        commandCompletion:
          preferences.commandNotifications ?? existingConfig?.commandCompletion ?? true,
        commandError: preferences.sessionError ?? existingConfig?.commandError ?? true,
        bell: preferences.systemAlerts ?? existingConfig?.bell ?? true,
        claudeTurn: preferences.claudeTurn ?? existingConfig?.claudeTurn ?? false,
      };

      // Update config
      configService.updateNotificationPreferences(notificationConfig);

      // Return updated preferences in API format
      const updatedPreferences: PushNotificationPreferences = {
        enabled: notificationConfig.enabled,
        sessionExit: notificationConfig.sessionExit,
        sessionStart: notificationConfig.sessionStart,
        sessionError: notificationConfig.commandError,
        commandNotifications: notificationConfig.commandCompletion,
        systemAlerts: notificationConfig.bell,
        claudeTurn: notificationConfig.claudeTurn,
        soundEnabled: true,
        vibrationEnabled: false,
      };

      logger.log('Updated notification preferences in config.json');
      res.json(updatedPreferences);
    } catch (error) {
      logger.error('Failed to update preferences:', error);
      res.status(500).json({ error: 'Failed to update preferences' });
    }
  });

  return router;
}
