import { type Request, type Response, Router } from 'express';
import type { BellEventHandler } from '../services/bell-event-handler.js';
import type { PushNotificationService } from '../services/push-notification-service.js';
import { PushNotificationStatusService } from '../services/push-notification-status-service.js';
import { createLogger } from '../utils/logger.js';
import type { VapidManager } from '../utils/vapid-manager.js';

const logger = createLogger('push-routes');

export interface CreatePushRoutesOptions {
  vapidManager: VapidManager;
  pushNotificationService: PushNotificationService | null;
  bellEventHandler?: BellEventHandler;
}

export function createPushRoutes(options: CreatePushRoutesOptions): Router {
  const { vapidManager, pushNotificationService } = options;
  const router = Router();

  /**
   * Get VAPID public key for client registration
   */
  router.get('/push/vapid-public-key', (_req: Request, res: Response) => {
    try {
      const publicKey = vapidManager.getPublicKey();

      if (!publicKey) {
        return res.status(503).json({
          error: 'Push notifications not configured',
          message: 'VAPID keys not available',
        });
      }

      if (!vapidManager.isEnabled()) {
        return res.status(503).json({
          error: 'Push notifications disabled',
          message: 'VAPID configuration incomplete',
        });
      }

      res.json({
        publicKey,
        enabled: true,
      });
    } catch (error) {
      logger.error('Failed to get VAPID public key:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve VAPID public key',
      });
    }
  });

  /**
   * Subscribe to push notifications
   */
  router.post('/push/subscribe', async (req: Request, res: Response) => {
    if (!pushNotificationService) {
      return res.status(503).json({
        error: 'Push notifications not initialized',
        message: 'Push notification service is not available',
      });
    }

    try {
      const { endpoint, keys } = req.body;

      if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
        return res.status(400).json({
          error: 'Invalid subscription data',
          message: 'Missing required subscription fields',
        });
      }

      const subscriptionId = await pushNotificationService.addSubscription(endpoint, keys);

      res.json({
        success: true,
        subscriptionId,
        message: 'Successfully subscribed to push notifications',
      });

      logger.log(`Push subscription created: ${subscriptionId}`);
    } catch (error) {
      logger.error('Failed to create push subscription:', error);
      res.status(500).json({
        error: 'Subscription failed',
        message: 'Failed to create push subscription',
      });
    }
  });

  /**
   * Unsubscribe from push notifications
   */
  router.post('/push/unsubscribe', async (req: Request, res: Response) => {
    if (!pushNotificationService) {
      return res.status(503).json({
        error: 'Push notifications not initialized',
        message: 'Push notification service is not available',
      });
    }

    try {
      const { endpoint } = req.body;

      if (!endpoint) {
        return res.status(400).json({
          error: 'Missing endpoint',
          message: 'Endpoint is required for unsubscription',
        });
      }

      // For simplicity, we'll find and remove by endpoint
      const subscriptions = pushNotificationService.getSubscriptions();
      const subscription = subscriptions.find((sub) => sub.endpoint === endpoint);

      if (subscription) {
        await pushNotificationService.removeSubscription(subscription.id);
        logger.log(`Push subscription removed: ${subscription.id}`);
      }

      res.json({
        success: true,
        message: 'Successfully unsubscribed from push notifications',
      });
    } catch (error) {
      logger.error('Failed to remove push subscription:', error);
      res.status(500).json({
        error: 'Unsubscription failed',
        message: 'Failed to remove push subscription',
      });
    }
  });

  /**
   * Send test notification
   */
  router.post('/push/test', async (_req: Request, res: Response) => {
    if (!pushNotificationService) {
      return res.status(503).json({
        error: 'Push notifications not initialized',
        message: 'Push notification service is not available',
      });
    }

    try {
      const result = await pushNotificationService.sendNotification({
        type: 'test',
        title: '🔔 Test Notification',
        body: 'This is a test notification from VibeTunnel',
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
      });

      res.json({
        success: result.success,
        sent: result.sent,
        failed: result.failed,
        errors: result.errors,
        message: `Test notification sent to ${result.sent} subscribers`,
      });

      logger.log(`Test notification sent: ${result.sent} successful, ${result.failed} failed`);
    } catch (error) {
      logger.error('Failed to send test notification:', error);
      res.status(500).json({
        error: 'Test notification failed',
        message: 'Failed to send test notification',
      });
    }
  });

  /**
   * Get service status
   */
  router.get('/push/status', (_req: Request, res: Response) => {
    if (!pushNotificationService) {
      return res.status(503).json({
        error: 'Push notifications not initialized',
        message: 'Push notification service is not available',
      });
    }

    try {
      const subscriptions = pushNotificationService.getSubscriptions();

      res.json({
        enabled: vapidManager.isEnabled(),
        hasVapidKeys: !!vapidManager.getPublicKey(),
        totalSubscriptions: subscriptions.length,
        activeSubscriptions: subscriptions.filter((sub) => sub.isActive).length,
        status: new PushNotificationStatusService(
          vapidManager,
          pushNotificationService
        ).getStatus(),
      });
    } catch (error) {
      logger.error('Failed to get push status:', error);
      res.status(500).json({
        error: 'Status check failed',
        message: 'Failed to retrieve push notification status',
      });
    }
  });

  return router;
}
