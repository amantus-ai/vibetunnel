/**
 * PushNotificationService - Simplified push notification system
 *
 * This simplified service provides:
 * - Basic subscription storage
 * - Simple notification sending without user tracking or preferences
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import webpush from 'web-push';
import { VapidManager } from '../utils/vapid-manager.js';
import { createLogger } from '../utils/logger.js';
import { BellNotificationPayload } from './bell-event-handler.js';

const logger = createLogger('push-notification-service');

/**
 * Simplified push subscription data structure
 */
export interface PushSubscription {
  id: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  subscribedAt: string;
  isActive: boolean;
}

/**
 * Generic notification payload
 */
export interface NotificationPayload {
  type: string;
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  requireInteraction?: boolean;
  actions?: Array<{
    action: string;
    title: string;
  }>;
  data?: any;
}

/**
 * Send notification result
 */
export interface SendNotificationResult {
  success: boolean;
  sent: number;
  failed: number;
  errors: string[];
}

/**
 * Simplified push notification service
 */
export class PushNotificationService {
  private vapidManager: VapidManager;
  private subscriptions = new Map<string, PushSubscription>();
  private initialized = false;
  private readonly subscriptionsFile: string;

  constructor(vapidManager: VapidManager) {
    this.vapidManager = vapidManager;
    const storageDir = path.join(os.homedir(), '.vibetunnel/notifications');
    this.subscriptionsFile = path.join(storageDir, 'subscriptions.json');
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Ensure storage directory exists
      await fs.mkdir(path.dirname(this.subscriptionsFile), { recursive: true });

      // Load existing subscriptions
      await this.loadSubscriptions();

      this.initialized = true;
      logger.log('PushNotificationService initialized');
    } catch (error) {
      logger.error('Failed to initialize PushNotificationService:', error);
      throw error;
    }
  }

  /**
   * Add a new subscription
   */
  async addSubscription(endpoint: string, keys: { p256dh: string; auth: string }): Promise<string> {
    const subscriptionId = this.generateSubscriptionId(endpoint, keys);

    const subscription: PushSubscription = {
      id: subscriptionId,
      endpoint,
      keys,
      subscribedAt: new Date().toISOString(),
      isActive: true,
    };

    this.subscriptions.set(subscriptionId, subscription);
    await this.saveSubscriptions();

    logger.log(`New subscription added: ${subscriptionId}`);
    return subscriptionId;
  }

  /**
   * Remove a subscription
   */
  async removeSubscription(subscriptionId: string): Promise<boolean> {
    const existed = this.subscriptions.delete(subscriptionId);
    if (existed) {
      await this.saveSubscriptions();
      logger.log(`Subscription removed: ${subscriptionId}`);
    }
    return existed;
  }

  /**
   * Get all active subscriptions
   */
  getSubscriptions(): PushSubscription[] {
    return Array.from(this.subscriptions.values()).filter((sub) => sub.isActive);
  }

  /**
   * Send notification to all subscriptions
   */
  async sendNotification(payload: NotificationPayload): Promise<SendNotificationResult> {
    if (!this.vapidManager.isEnabled()) {
      throw new Error('VAPID not properly configured');
    }

    const activeSubscriptions = this.getSubscriptions();
    if (activeSubscriptions.length === 0) {
      return {
        success: true,
        sent: 0,
        failed: 0,
        errors: [],
      };
    }

    let successful = 0;
    let failed = 0;
    const errors: string[] = [];

    const webPushPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/apple-touch-icon.png',
      badge: payload.badge || '/favicon-32.png',
      tag: payload.tag || `vibetunnel-${payload.type}`,
      requireInteraction: payload.requireInteraction || false,
      actions: payload.actions || [],
      data: {
        type: payload.type,
        timestamp: new Date().toISOString(),
        ...payload.data,
      },
    });

    // Send to all subscriptions
    for (const subscription of activeSubscriptions) {
      try {
        const webpushSubscription: webpush.PushSubscription = {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
        };

        await this.vapidManager.sendNotification(webpushSubscription, webPushPayload);
        successful++;

        logger.debug(`Notification sent to: ${subscription.id}`);
      } catch (error) {
        failed++;
        const errorMsg = `Failed to send to ${subscription.id}: ${error}`;
        errors.push(errorMsg);
        logger.warn(errorMsg);

        // Remove expired/invalid subscriptions
        const shouldRemove = this.shouldRemoveSubscription(error);
        if (shouldRemove) {
          this.subscriptions.delete(subscription.id);
          logger.log(
            `Removed expired subscription: ${subscription.id} (status: ${(error as any).statusCode})`
          );
        } else {
          // Debug log for unhandled errors
          logger.debug(
            `Not removing subscription ${subscription.id}, error: ${error instanceof Error ? error.message : String(error)}, statusCode: ${(error as any).statusCode}`
          );
        }
      }
    }

    // Save updated subscriptions
    await this.saveSubscriptions();

    logger.log(`Notification sent: ${successful} successful, ${failed} failed`, {
      type: payload.type,
      title: payload.title,
    });

    return {
      success: true,
      sent: successful,
      failed,
      errors,
    };
  }

  /**
   * Send bell notification
   */
  async sendBellNotification(
    bellPayload: BellNotificationPayload
  ): Promise<SendNotificationResult> {
    const payload: NotificationPayload = {
      type: 'bell',
      title: bellPayload.title,
      body: bellPayload.body,
      icon: bellPayload.icon,
      badge: bellPayload.badge,
      tag: bellPayload.tag,
      requireInteraction: bellPayload.requireInteraction,
      actions: bellPayload.actions,
      data: bellPayload.data,
    };

    return await this.sendNotification(payload);
  }

  /**
   * Determine if a subscription should be removed based on the error
   */
  private shouldRemoveSubscription(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    // Check for HTTP 410 Gone status (subscription expired)
    // WebPushError has a statusCode property
    const webPushError = error as any;
    if (webPushError.statusCode === 410) {
      return true;
    }

    // Also check message content for other error formats
    if (error.message.includes('410') || error.message.includes('Gone')) {
      return true;
    }

    // Check for other expired/invalid subscription indicators
    const errorMessage = error.message.toLowerCase();
    return (
      errorMessage.includes('invalid') ||
      errorMessage.includes('expired') ||
      errorMessage.includes('no such subscription') ||
      errorMessage.includes('unsubscribed')
    );
  }

  /**
   * Clean up inactive subscriptions
   */
  async cleanupInactiveSubscriptions(): Promise<number> {
    const beforeCount = this.subscriptions.size;

    // Remove all inactive subscriptions
    const activeSubscriptions = Array.from(this.subscriptions.values()).filter(
      (subscription) => subscription.isActive
    );

    this.subscriptions.clear();
    for (const subscription of activeSubscriptions) {
      this.subscriptions.set(subscription.id, subscription);
    }

    const removedCount = beforeCount - this.subscriptions.size;

    if (removedCount > 0) {
      await this.saveSubscriptions();
      logger.log(`Cleaned up ${removedCount} inactive subscriptions`);
    }

    return removedCount;
  }

  /**
   * Load subscriptions from file
   */
  private async loadSubscriptions(): Promise<void> {
    try {
      const data = await fs.readFile(this.subscriptionsFile, 'utf8');
      const subscriptions: PushSubscription[] = JSON.parse(data);

      this.subscriptions.clear();
      for (const subscription of subscriptions) {
        this.subscriptions.set(subscription.id, subscription);
      }

      logger.debug(`Loaded ${subscriptions.length} subscriptions`);
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        logger.debug('No existing subscriptions file found');
      } else {
        logger.error('Failed to load subscriptions:', error);
      }
    }
  }

  /**
   * Save subscriptions to file
   */
  private async saveSubscriptions(): Promise<void> {
    try {
      const subscriptions = Array.from(this.subscriptions.values());
      await fs.writeFile(this.subscriptionsFile, JSON.stringify(subscriptions, null, 2));
      logger.debug(`Saved ${subscriptions.length} subscriptions`);
    } catch (error) {
      logger.error('Failed to save subscriptions:', error);
    }
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    await this.saveSubscriptions();
    logger.log('PushNotificationService shutdown');
  }

  /**
   * Generate unique subscription ID
   */
  private generateSubscriptionId(endpoint: string, keys: { p256dh: string; auth: string }): string {
    try {
      const url = new URL(endpoint);
      const hash = Buffer.from(keys.p256dh).toString('base64').substring(0, 8);
      return `${url.hostname}-${hash}`;
    } catch {
      // Fallback to a hash of the entire endpoint
      return Buffer.from(endpoint).toString('base64').substring(0, 16);
    }
  }
}
