import type { VapidManager } from '../utils/vapid-manager.js';
import type { PushNotificationService } from './push-notification-service.js';

export class PushNotificationStatusService {
  constructor(
    private vapidManager: VapidManager,
    private pushNotificationService: PushNotificationService | null
  ) {}

  getStatus() {
    if (!this.pushNotificationService) {
      return {
        enabled: false,
        configured: false,
        subscriptions: 0,
        error: 'Push notification service not initialized',
      };
    }

    const subscriptions = this.pushNotificationService.getSubscriptions();

    return {
      enabled: this.vapidManager.isEnabled(),
      configured: !!this.vapidManager.getPublicKey(),
      subscriptions: subscriptions.length,
    };
  }
}
