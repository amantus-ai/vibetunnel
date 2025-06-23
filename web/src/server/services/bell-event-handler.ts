/**
 * BellEventHandler - Ultra-simple bell event handler
 *
 * This simplified handler just sends notifications for bell events
 * without any filtering, correlation, or user tracking.
 */

import { SessionInfo } from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';
import { PushNotificationService } from './push-notification-service.js';
import { ProcessSnapshot, ProcessInfo, ProcessTreeAnalyzer } from './process-tree-analyzer.js';

const logger = createLogger('bell-event-handler');

/**
 * Enhanced bell event context with process information
 */
export interface BellEventContext {
  sessionInfo: SessionInfo;
  timestamp: Date;
  bellCount?: number;
  processSnapshot?: ProcessSnapshot;
  suspectedSource?: ProcessInfo | null;
}

/**
 * Simple bell notification payload
 */
export interface BellNotificationPayload {
  type: 'bell-event';
  sessionId: string;
  sessionName: string;
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag: string;
  requireInteraction: boolean;
  actions?: Array<{
    action: string;
    title: string;
  }>;
  data: {
    sessionId: string;
    timestamp: string;
    processName?: string;
    processCommand?: string;
    processPid?: number;
  };
}

/**
 * Ultra-simple bell event handler
 */
export class BellEventHandler {
  private pushNotificationService: PushNotificationService | null = null;

  constructor() {
    logger.debug('BellEventHandler initialized');
  }

  /**
   * Set the push notification service for sending notifications
   */
  setPushNotificationService(service: PushNotificationService): void {
    this.pushNotificationService = service;
    logger.debug('Push notification service configured');
  }

  /**
   * Process a bell event - ultra-simple version
   */
  async processBellEvent(context: BellEventContext): Promise<void> {
    try {
      logger.debug('Processing bell event', {
        sessionId: context.sessionInfo.id,
        timestamp: context.timestamp.toISOString(),
      });

      // Always send notification - no filtering
      if (this.pushNotificationService) {
        const payload = this.createNotificationPayload(context);
        await this.sendPushNotification(payload);
      }

      logger.debug('Bell event processed successfully', {
        sessionId: context.sessionInfo.id,
      });
    } catch (error) {
      logger.error('Error processing bell event', {
        sessionId: context.sessionInfo.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Create enhanced notification payload with process information
   */
  private createNotificationPayload(context: BellEventContext): BellNotificationPayload {
    const sessionName = context.sessionInfo.name || 'Terminal Session';

    // Extract process information if available
    const processName = context.suspectedSource
      ? ProcessTreeAnalyzer.extractProcessName(context.suspectedSource.command)
      : null;
    const processDescription = ProcessTreeAnalyzer.getProcessDescription(
      context.suspectedSource || null
    );

    // Create title and body with process information
    const title = '🔔 Terminal Activity';
    const body =
      processName && processName !== 'shell'
        ? `${processDescription} in ${sessionName} triggered a bell`
        : `${sessionName} triggered a bell`;
    const tag = `vibetunnel-bell-${context.sessionInfo.id}`;

    return {
      type: 'bell-event',
      sessionId: context.sessionInfo.id,
      sessionName,
      title,
      body,
      icon: '/apple-touch-icon.png',
      badge: '/favicon-32.png',
      tag,
      requireInteraction: false,
      actions: [
        {
          action: 'view-session',
          title: 'View Session',
        },
        {
          action: 'dismiss',
          title: 'Dismiss',
        },
      ],
      data: {
        sessionId: context.sessionInfo.id,
        timestamp: context.timestamp.toISOString(),
        processName: processName || undefined,
        processCommand: context.suspectedSource?.command || undefined,
        processPid: context.suspectedSource?.pid || undefined,
      },
    };
  }

  /**
   * Send push notification
   */
  private async sendPushNotification(payload: BellNotificationPayload): Promise<void> {
    if (!this.pushNotificationService) {
      logger.debug('No push notification service configured');
      return;
    }

    try {
      await this.pushNotificationService.sendBellNotification(payload);
      logger.debug('Push notification sent', {
        sessionId: payload.sessionId,
        title: payload.title,
      });
    } catch (error) {
      logger.error('Failed to send push notification', {
        sessionId: payload.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    logger.debug('BellEventHandler disposed');
  }
}
