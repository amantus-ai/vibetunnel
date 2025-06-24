import { createLogger } from './logger.js';

const logger = createLogger('offline-notification-manager');

// IndexedDB database name and version
const DB_NAME = 'vibetunnel-offline';
const DB_VERSION = 1;
const STORE_NAME = 'notifications';

export interface OfflineNotification {
  id: string;
  timestamp: number;
  payload: unknown;
  retryCount: number;
  maxRetries: number;
  nextRetry: number;
}

export interface NotificationQueueStats {
  total: number;
  pending: number;
  failed: number;
  lastProcessed: number;
}

export class OfflineNotificationManager {
  private db: IDBDatabase | null = null;
  private isOnline = navigator.onLine;
  private processingQueue = false;
  private initialized = false;

  constructor() {
    this.initialize().catch((error) => {
      logger.error('failed to initialize offline notification manager:', error);
    });
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Initialize IndexedDB
      await this.initializeDB();

      // Setup online/offline event listeners
      this.setupOnlineListeners();

      // Process any queued notifications if online
      if (this.isOnline) {
        this.processQueue().catch((error) => {
          logger.error('failed to process initial queue:', error);
        });
      }

      this.initialized = true;
      logger.log('offline notification manager initialized');
    } catch (error) {
      logger.error('failed to initialize offline notification manager:', error);
      throw error;
    }
  }

  private async initializeDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(new Error('Failed to open IndexedDB'));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create notifications store
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp');
          store.createIndex('nextRetry', 'nextRetry');
        }
      };
    });
  }

  private setupOnlineListeners(): void {
    window.addEventListener('online', () => {
      logger.log('connection restored, processing queued notifications');
      this.isOnline = true;
      this.processQueue().catch((error) => {
        logger.error('failed to process queue after going online:', error);
      });
    });

    window.addEventListener('offline', () => {
      logger.log('connection lost, queueing notifications');
      this.isOnline = false;
    });
  }

  /**
   * Queue a notification for later delivery when online
   */
  async queueNotification(payload: unknown, maxRetries: number = 3): Promise<string> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const notification: OfflineNotification = {
      id: this.generateId(),
      timestamp: Date.now(),
      payload,
      retryCount: 0,
      maxRetries,
      nextRetry: Date.now(),
    };

    try {
      await this.storeNotification(notification);
      logger.log('notification queued:', notification.id);

      // Try to process immediately if online
      if (this.isOnline) {
        this.processQueue().catch((error) => {
          logger.error('failed to process queue after queueing:', error);
        });
      }

      return notification.id;
    } catch (error) {
      logger.error('failed to queue notification:', error);
      throw error;
    }
  }

  /**
   * Process queued notifications
   */
  private async processQueue(): Promise<void> {
    if (!this.db || this.processingQueue || !this.isOnline) {
      return;
    }

    this.processingQueue = true;

    try {
      const notifications = await this.getPendingNotifications();
      logger.log(`processing ${notifications.length} queued notifications`);

      for (const notification of notifications) {
        try {
          await this.processNotification(notification);
        } catch (error) {
          logger.error('failed to process notification:', notification.id, error);
        }
      }
    } catch (error) {
      logger.error('failed to process notification queue:', error);
    } finally {
      this.processingQueue = false;
    }
  }

  private async processNotification(notification: OfflineNotification): Promise<void> {
    try {
      // Send notification to service worker
      const registration = await navigator.serviceWorker.ready;
      registration.active?.postMessage({
        type: 'QUEUE_NOTIFICATION',
        payload: notification.payload,
      });

      // Remove from queue on success
      await this.removeNotification(notification.id);
      logger.log('notification processed successfully:', notification.id);
    } catch (error) {
      // Increment retry count
      notification.retryCount++;

      if (notification.retryCount >= notification.maxRetries) {
        // Max retries reached, remove from queue
        await this.removeNotification(notification.id);
        logger.warn('notification max retries reached, removing:', notification.id);
      } else {
        // Schedule retry with exponential backoff
        const backoffMs = Math.pow(2, notification.retryCount) * 1000;
        notification.nextRetry = Date.now() + backoffMs;

        await this.updateNotification(notification);
        logger.log(
          `notification retry scheduled for ${new Date(notification.nextRetry).toISOString()}:`,
          notification.id
        );
      }

      throw error;
    }
  }

  private async getPendingNotifications(): Promise<OfflineNotification[]> {
    if (!this.db) {
      return [];
    }

    const db = this.db;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('nextRetry');

      // Get notifications that are ready to retry
      const range = IDBKeyRange.upperBound(Date.now());
      const request = index.getAll(range);

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(new Error('Failed to get pending notifications'));
      };
    });
  }

  private async storeNotification(notification: OfflineNotification): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const db = this.db;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(notification);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to store notification'));
    });
  }

  private async updateNotification(notification: OfflineNotification): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const db = this.db;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(notification);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to update notification'));
    });
  }

  private async removeNotification(id: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const db = this.db;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to remove notification'));
    });
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<NotificationQueueStats> {
    if (!this.db) {
      return { total: 0, pending: 0, failed: 0, lastProcessed: 0 };
    }

    const db = this.db;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const notifications = request.result;
        const now = Date.now();

        const stats: NotificationQueueStats = {
          total: notifications.length,
          pending: notifications.filter((n) => n.nextRetry <= now && n.retryCount < n.maxRetries)
            .length,
          failed: notifications.filter((n) => n.retryCount >= n.maxRetries).length,
          lastProcessed: Math.max(...notifications.map((n) => n.timestamp), 0),
        };

        resolve(stats);
      };

      request.onerror = () => {
        reject(new Error('Failed to get queue stats'));
      };
    });
  }

  /**
   * Clear all queued notifications
   */
  async clearQueue(): Promise<void> {
    if (!this.db) {
      return;
    }

    const db = this.db;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        logger.log('notification queue cleared');
        resolve();
      };

      request.onerror = () => {
        reject(new Error('Failed to clear queue'));
      };
    });
  }

  /**
   * Check if device is online
   */
  isDeviceOnline(): boolean {
    return this.isOnline;
  }

  /**
   * Force process queue (useful for testing)
   */
  async forceProcessQueue(): Promise<void> {
    if (this.isOnline) {
      await this.processQueue();
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }

    window.removeEventListener('online', this.processQueue);
    window.removeEventListener('offline', () => {});

    this.initialized = false;
  }
}

// Create singleton instance
export const offlineNotificationManager = new OfflineNotificationManager();
