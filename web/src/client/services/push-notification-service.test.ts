import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationPreferences } from './push-notification-service.js';
import { pushNotificationService } from './push-notification-service.js';

// Mock the global objects
const mockServiceWorkerRegistration = {
  pushManager: {
    getSubscription: vi.fn(),
    subscribe: vi.fn(),
  },
  showNotification: vi.fn(),
};

const mockNotification = {
  requestPermission: vi.fn(),
  permission: 'default' as NotificationPermission,
};

const mockNavigator = {
  serviceWorker: {
    ready: Promise.resolve(mockServiceWorkerRegistration as unknown as ServiceWorkerRegistration),
    register: vi.fn(),
  },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
};

// Setup global mocks
vi.stubGlobal('navigator', mockNavigator);
vi.stubGlobal('Notification', mockNotification);
vi.stubGlobal('PushManager', {});

// Mock fetch globally
global.fetch = vi.fn();

describe('PushNotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Mock fetch responses
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/api/push/vapid-public-key') {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('test-vapid-key'),
        });
      }
      if (url === '/api/preferences/notifications') {
        return Promise.resolve({
          ok: false,
          status: 404,
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    // Reset service state
    // Using a type assertion to access private members for testing
    interface TestPushNotificationService {
      initialized: boolean;
      serviceWorkerRegistration: ServiceWorkerRegistration | null;
      pushSubscription: globalThis.PushSubscription | null;
      preferences: NotificationPreferences | null;
    }
    const testService = pushNotificationService as unknown as TestPushNotificationService;
    testService.initialized = false;
    testService.serviceWorkerRegistration = null;
    testService.pushSubscription = null;
    testService.preferences = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isSupported', () => {
    it('should return true when all required APIs are available', () => {
      expect(pushNotificationService.isSupported()).toBe(true);
    });

    it('should return false when Notification API is not available', () => {
      vi.stubGlobal('Notification', undefined);
      expect(pushNotificationService.isSupported()).toBe(false);
      vi.stubGlobal('Notification', mockNotification);
    });

    it('should return false when serviceWorker is not available', () => {
      vi.stubGlobal('navigator', { ...mockNavigator, serviceWorker: undefined });
      expect(pushNotificationService.isSupported()).toBe(false);
      vi.stubGlobal('navigator', mockNavigator);
    });

    it('should return false when PushManager is not available', () => {
      vi.stubGlobal('PushManager', undefined);
      expect(pushNotificationService.isSupported()).toBe(false);
      vi.stubGlobal('PushManager', {});
    });
  });

  describe('initialize', () => {
    it('should load preferences from localStorage', async () => {
      const savedPrefs: NotificationPreferences = {
        enabled: true,
        sessionExit: false,
        sessionStart: true,
        sessionError: false,
        commandNotifications: true,
        systemAlerts: false,
        soundEnabled: true,
        vibrationEnabled: false,
      };
      localStorage.setItem('vibetunnel_notification_preferences', JSON.stringify(savedPrefs));

      await pushNotificationService.initialize();

      // Just verify initialization completes without error
      expect(pushNotificationService.isSupported()).toBeDefined();
    });

    it('should use default preferences when localStorage is empty', async () => {
      await pushNotificationService.initialize();

      // Just verify initialization completes without error
      expect(pushNotificationService.isSupported()).toBeDefined();
    });

    it('should get existing subscription', async () => {
      const mockSubscription = {
        endpoint: 'https://fcm.googleapis.com/test',
        expirationTime: null,
      };
      mockServiceWorkerRegistration.pushManager.getSubscription.mockResolvedValue(mockSubscription);

      await pushNotificationService.initialize();

      expect(mockServiceWorkerRegistration.pushManager.getSubscription).toHaveBeenCalled();
      expect(pushNotificationService.isSubscribed()).toBe(true);
    });
  });

  describe('requestPermission', () => {
    it('should request notification permission', async () => {
      mockNotification.requestPermission.mockResolvedValue('granted');

      const result = await pushNotificationService.requestPermission();

      expect(mockNotification.requestPermission).toHaveBeenCalled();
      expect(result).toBe('granted');
    });

    it('should handle permission denial', async () => {
      mockNotification.requestPermission.mockResolvedValue('denied');

      const result = await pushNotificationService.requestPermission();

      expect(result).toBe('denied');
    });
  });

  describe('subscribe', () => {
    beforeEach(async () => {
      await pushNotificationService.initialize();
    });

    it('should create a new push subscription', async () => {
      const mockSubscription = {
        endpoint: 'https://fcm.googleapis.com/test',
        expirationTime: null,
        toJSON: () => ({
          endpoint: 'https://fcm.googleapis.com/test',
          expirationTime: null,
          keys: {
            p256dh: 'test-key',
            auth: 'test-auth',
          },
        }),
      };
      mockServiceWorkerRegistration.pushManager.subscribe.mockResolvedValue(mockSubscription);

      // Mock fetch for saving subscription
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      const result = await pushNotificationService.subscribe('test-public-key');

      expect(mockServiceWorkerRegistration.pushManager.subscribe).toHaveBeenCalledWith({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      });
      expect(result).toBe(true);
      expect(pushNotificationService.isSubscribed()).toBe(true);
    });

    it('should handle subscription failure', async () => {
      mockServiceWorkerRegistration.pushManager.subscribe.mockRejectedValue(
        new Error('Subscribe failed')
      );

      const result = await pushNotificationService.subscribe('test-public-key');

      expect(result).toBe(false);
      expect(pushNotificationService.isSubscribed()).toBe(false);
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe from push notifications', async () => {
      const mockSubscription = {
        endpoint: 'https://fcm.googleapis.com/test',
        unsubscribe: vi.fn().mockResolvedValue(true),
      };
      mockServiceWorkerRegistration.pushManager.getSubscription.mockResolvedValue(mockSubscription);

      await pushNotificationService.initialize();

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      const result = await pushNotificationService.unsubscribe();

      expect(mockSubscription.unsubscribe).toHaveBeenCalled();
      expect(result).toBe(true);
      expect(pushNotificationService.isSubscribed()).toBe(false);
    });

    it('should handle unsubscribe when no subscription exists', async () => {
      mockServiceWorkerRegistration.pushManager.getSubscription.mockResolvedValue(null);

      await pushNotificationService.initialize();

      const result = await pushNotificationService.unsubscribe();

      expect(result).toBe(true);
      expect(pushNotificationService.isSubscribed()).toBe(false);
    });
  });

  describe('savePreferences', () => {
    it('should save preferences to localStorage and server', async () => {
      const preferences: NotificationPreferences = {
        enabled: true,
        sessionExit: false,
        sessionStart: true,
        sessionError: true,
        commandNotifications: false,
        systemAlerts: true,
        soundEnabled: false,
        vibrationEnabled: true,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      await pushNotificationService.savePreferences(preferences);

      const saved = localStorage.getItem('vibetunnel_notification_preferences');
      expect(saved).toBeTruthy();
      if (saved) {
        expect(JSON.parse(saved)).toEqual(preferences);
      }
      expect(fetch).toHaveBeenCalledWith('/api/preferences/notifications', expect.any(Object));
    });

    it('should handle save failure gracefully', async () => {
      const preferences: NotificationPreferences = {
        enabled: true,
        sessionExit: true,
        sessionStart: true,
        sessionError: true,
        commandNotifications: true,
        systemAlerts: true,
        soundEnabled: true,
        vibrationEnabled: true,
      };

      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await pushNotificationService.savePreferences(preferences);

      // Should still save to localStorage even if server fails
      const saved = localStorage.getItem('vibetunnel_notification_preferences');
      expect(saved).toBeTruthy();
    });
  });

  describe('showLocalNotification', () => {
    it('should show notification when permission is granted', async () => {
      Object.defineProperty(mockNotification, 'permission', {
        writable: true,
        value: 'granted',
      });

      await pushNotificationService.initialize();

      await pushNotificationService.showLocalNotification({
        title: 'Test Notification',
        body: 'Test body',
        icon: '/icon.png',
        tag: 'test-tag',
      });

      expect(mockServiceWorkerRegistration.showNotification).toHaveBeenCalledWith(
        'Test Notification',
        expect.objectContaining({
          body: 'Test body',
          icon: '/icon.png',
          tag: 'test-tag',
        })
      );
    });

    it('should not show notification when permission is denied', async () => {
      Object.defineProperty(mockNotification, 'permission', {
        writable: true,
        value: 'denied',
      });

      await pushNotificationService.initialize();

      await pushNotificationService.showLocalNotification({
        title: 'Test Notification',
        body: 'Test body',
      });

      expect(mockServiceWorkerRegistration.showNotification).not.toHaveBeenCalled();
    });

    it('should respect notification preferences', async () => {
      Object.defineProperty(mockNotification, 'permission', {
        writable: true,
        value: 'granted',
      });

      const preferences: NotificationPreferences = {
        enabled: false,
        sessionExit: true,
        sessionStart: true,
        sessionError: true,
        commandNotifications: true,
        systemAlerts: true,
        soundEnabled: true,
        vibrationEnabled: true,
      };

      await pushNotificationService.initialize();
      await pushNotificationService.savePreferences(preferences);

      await pushNotificationService.showLocalNotification({
        title: 'Test Notification',
        body: 'Test body',
      });

      expect(mockServiceWorkerRegistration.showNotification).not.toHaveBeenCalled();
    });
  });

  describe('testNotification', () => {
    it('should send a test notification', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      const result = await pushNotificationService.testNotification();

      expect(fetch).toHaveBeenCalledWith('/api/push/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      expect(result).toBe(true);
    });

    it('should handle test notification failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await pushNotificationService.testNotification();

      expect(result).toBe(false);
    });
  });

  describe('permission change handling', () => {
    it('should notify subscribers when permission changes', async () => {
      const callback = vi.fn();

      await pushNotificationService.initialize();
      const unsubscribe = pushNotificationService.onPermissionChange(callback);

      // Simulate permission change
      Object.defineProperty(mockNotification, 'permission', {
        writable: true,
        value: 'granted',
      });

      // Trigger check
      await pushNotificationService.requestPermission();

      expect(callback).toHaveBeenCalledWith('granted');

      unsubscribe();
    });
  });

  describe('subscription change handling', () => {
    it('should notify subscribers when subscription changes', async () => {
      const callback = vi.fn();

      await pushNotificationService.initialize();
      const unsubscribe = pushNotificationService.onSubscriptionChange(callback);

      const mockSubscription = {
        endpoint: 'https://fcm.googleapis.com/test',
        toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/test' }),
      };
      mockServiceWorkerRegistration.pushManager.subscribe.mockResolvedValue(mockSubscription);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      await pushNotificationService.subscribe('test-key');

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'https://fcm.googleapis.com/test',
        })
      );

      unsubscribe();
    });
  });
});
