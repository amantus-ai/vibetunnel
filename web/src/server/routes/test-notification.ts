import { type Request, type Response, Router } from 'express';
import { ServerEventType } from '../../shared/types.js';
import type { PushNotificationService } from '../services/push-notification-service.js';
import type { SessionMonitor } from '../services/session-monitor.js';
import { createLogger } from '../utils/logger.js';
import { getVersionInfo } from '../version.js';

const logger = createLogger('test-notification');

interface TestNotificationOptions {
  sessionMonitor?: SessionMonitor;
  pushNotificationService?: PushNotificationService | null;
}

/**
 * Test notification endpoint to verify the full notification flow
 * from server → WS v3 `EVENT` → clients AND push notifications
 */
export function createTestNotificationRouter(options: TestNotificationOptions): Router {
  const { sessionMonitor, pushNotificationService } = options;
  const router = Router();

  // POST /api/test-notification - Trigger a test notification through WS v3 events and push.
  router.post('/test-notification', async (req: Request, res: Response) => {
    logger.info('📨 Test notification requested from client');
    logger.debug('Request headers:', req.headers);

    if (!sessionMonitor) {
      logger.error('❌ SessionMonitor not available - notification system not initialized');
      return res.status(503).json({
        error: 'Notification system not initialized',
      });
    }

    try {
      // Get server version info
      const versionInfo = getVersionInfo();

      // Create the test notification event
      const testEvent = {
        type: ServerEventType.TestNotification,
        sessionId: 'test-session',
        sessionName: 'Test Notification',
        timestamp: new Date().toISOString(),
        message: 'This is a test notification from VibeTunnel server',
        title: `VibeTunnel Test v${versionInfo.version}`,
        body: `Server-side notifications are working correctly! Server version: ${versionInfo.version}`,
      };

      logger.info('📤 Emitting test notification event through SessionMonitor:', testEvent);

      // Emit a test notification event through SessionMonitor.
      // This will be picked up by the WS v3 hub and sent to all connected clients.
      sessionMonitor.emit('notification', testEvent);

      logger.info('✅ Test notification event emitted successfully');

      // Also send through push notification service if available
      let pushResult = null;
      if (pushNotificationService) {
        try {
          logger.info('📤 Sending test notification through push service...');
          pushResult = await pushNotificationService.sendNotification({
            type: 'test',
            title: testEvent.title || '🔔 Test Notification',
            body: testEvent.body || 'This is a test notification from VibeTunnel',
            icon: '/apple-touch-icon.png',
            badge: '/favicon-32.png',
            tag: 'vibetunnel-test',
            requireInteraction: false,
            actions: [
              {
                action: 'dismiss',
                title: 'Dismiss',
              },
            ],
            data: {
              type: 'test-notification',
              sessionId: testEvent.sessionId,
              timestamp: testEvent.timestamp,
            },
          });
          logger.info(`✅ Push notification sent to ${pushResult.sent} subscribers`);
        } catch (error) {
          logger.error('❌ Failed to send push notification:', error);
        }
      }

      res.json({
        success: true,
        message: 'Test notification sent through events and push',
        event: testEvent,
        pushResult,
      });
    } catch (error) {
      logger.error('❌ Failed to send test notification:', error);
      res.status(500).json({
        error: 'Failed to send test notification',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  return router;
}
