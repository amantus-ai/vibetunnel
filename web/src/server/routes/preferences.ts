import { type Request, type Response, Router } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { PushNotificationPreferences } from '../../shared/types.js';
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
 * These preferences are synced between the web UI and macOS app
 */
export function createPreferencesRouter(): Router {
  const router = Router();
  // Store preferences in a temp directory for now
  const preferencesPath = path.join(
    process.env.HOME || '/tmp',
    '.vibetunnel',
    'notification-preferences.json'
  );

  // Get notification preferences
  router.get('/preferences/notifications', async (_req: Request, res: Response) => {
    try {
      // Try to read from file
      const data = await fs.readFile(preferencesPath, 'utf-8');
      const preferences = JSON.parse(data) as PushNotificationPreferences;
      res.json(preferences);
    } catch {
      // File doesn't exist or is invalid, return defaults
      logger.debug('No preferences file found, returning defaults');
      res.json(DEFAULT_PREFERENCES);
    }
  });

  // Update notification preferences
  router.put('/preferences/notifications', async (req: Request, res: Response) => {
    try {
      const preferences = req.body as Partial<PushNotificationPreferences>;

      // Merge with existing preferences
      let existingPreferences = DEFAULT_PREFERENCES;
      try {
        const data = await fs.readFile(preferencesPath, 'utf-8');
        existingPreferences = JSON.parse(data) as PushNotificationPreferences;
      } catch {
        // Ignore read errors, use defaults
      }

      const updatedPreferences: PushNotificationPreferences = {
        ...existingPreferences,
        ...preferences,
      };

      // Ensure directory exists
      await fs.mkdir(path.dirname(preferencesPath), { recursive: true });

      // Save to file
      await fs.writeFile(preferencesPath, JSON.stringify(updatedPreferences, null, 2), 'utf-8');

      logger.log('Updated notification preferences');
      res.json(updatedPreferences);
    } catch (error) {
      logger.error('Failed to update preferences:', error);
      res.status(500).json({ error: 'Failed to update preferences' });
    }
  });

  return router;
}
