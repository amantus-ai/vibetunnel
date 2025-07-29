import { type Request, type Response, Router } from 'express';
import { ServerEventType } from '../../shared/types.js';
import type { SessionMonitor } from '../services/session-monitor.js';
import { createLogger } from '../utils/logger.js';
import { getVersionInfo } from '../version.js';

const logger = createLogger('test-notification');

/**
 * Test notification endpoint to verify the full notification flow
 * from server → SSE → Mac app
 */
export function createTestNotificationRouter(sessionMonitor?: SessionMonitor): Router {
  const router = Router();

  // POST /api/test-notification - Trigger a test notification through the SSE system
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

      // Emit a test notification event through SessionMonitor
      // This will be picked up by the SSE endpoint and sent to all connected clients
      sessionMonitor.emit('notification', testEvent);

      logger.info('✅ Test notification event emitted successfully');

      res.json({
        success: true,
        message: 'Test notification sent through SSE',
        event: testEvent,
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
