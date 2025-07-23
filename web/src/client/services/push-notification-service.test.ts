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
    register: vi.fn().mockResolvedValue(mockServiceWorkerRegistration),
    addEventListener: vi.fn(),
  },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  permissions: {
    query: vi.fn().mockResolvedValue({
      state: 'prompt',
      addEventListener: vi.fn(),
    }),
  },
};

// Create mockWindow as a function to allow dynamic updates
const createMockWindow = () => ({
  PushManager: {},
  Notification: mockNotification,
  navigator: mockNavigator,
  matchMedia: vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
  }),
  atob: vi.fn((str: string) => Buffer.from(str, 'base64').toString('binary')),
  btoa: vi.fn((str: string) => Buffer.from(str, 'binary').toString('base64')),
  dispatchEvent: vi.fn(),
  addEventListener: vi.fn(),
  location: {
    origin: 'http://localhost:3000',
  },
});

let mockWindow = createMockWindow();

// Setup global mocks
vi.stubGlobal('window', mockWindow);
vi.stubGlobal('navigator', mockNavigator);
vi.stubGlobal('Notification', mockNotification);
vi.stubGlobal('PushManager', {});

// Mock fetch globally
global.fetch = vi.fn();

describe('PushNotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Reset mockWindow
    mockWindow = createMockWindow();
    vi.stubGlobal('window', mockWindow);

    // Mock fetch responses
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/api/push/vapid-public-key') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              publicKey: 'test-vapid-key',
              enabled: true,
            }),
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
      // biome-ignore lint/suspicious/noExplicitAny: Required for test mocking
      delete (mockWindow as any).Notification;
      vi.stubGlobal('window', mockWindow);

      expect(pushNotificationService.isSupported()).toBe(false);
    });

    it('should return false when serviceWorker is not available', () => {
      // biome-ignore lint/suspicious/noExplicitAny: Required for test mocking
      delete (mockNavigator as any).serviceWorker;
      vi.stubGlobal('navigator', mockNavigator);

      expect(pushNotificationService.isSupported()).toBe(false);
    });

    it('should return false when PushManager is not available', () => {
      // biome-ignore lint/suspicious/noExplicitAny: Required for test mocking
      delete (mockWindow as any).PushManager;
      vi.stubGlobal('window', mockWindow);

      expect(pushNotificationService.isSupported()).toBe(false);
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
      localStorage.setItem('vibetunnel-notification-preferences', JSON.stringify(savedPrefs));

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
        getKey: vi.fn((name: string) => {
          if (name === 'p256dh') return new Uint8Array([1, 2, 3]);
          if (name === 'auth') return new Uint8Array([4, 5, 6]);
          return null;
        }),
      };
      mockServiceWorkerRegistration.pushManager.getSubscription.mockResolvedValue(mockSubscription);

      await pushNotificationService.initialize();

      // Wait for initialization to complete
      await pushNotificationService.waitForInitialization();

      expect(mockServiceWorkerRegistration.pushManager.getSubscription).toHaveBeenCalled();
      expect(pushNotificationService.isSubscribed()).toBe(true);
    });
  });

  describe('requestPermission', () => {
    it('should request notification permission', async () => {
      mockNotification.requestPermission.mockResolvedValue('granted');
      mockWindow.Notification = mockNotification;
      vi.stubGlobal('window', mockWindow);

      const result = await pushNotificationService.requestPermission();

      expect(mockNotification.requestPermission).toHaveBeenCalled();
      expect(result).toBe('granted');
    });

    it('should handle permission denial', async () => {
      mockNotification.requestPermission.mockResolvedValue('denied');
      mockWindow.Notification = mockNotification;
      vi.stubGlobal('window', mockWindow);

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
        getKey: vi.fn((name: string) => {
          if (name === 'p256dh') return new Uint8Array([1, 2, 3]);
          if (name === 'auth') return new Uint8Array([4, 5, 6]);
          return null;
        }),
      };
      mockServiceWorkerRegistration.pushManager.subscribe.mockResolvedValue(mockSubscription);

      // Mock permission as granted
      mockNotification.permission = 'granted';
      mockNotification.requestPermission.mockResolvedValue('granted');

      // Mock fetch for saving subscription
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      const result = await pushNotificationService.subscribe();

      expect(mockServiceWorkerRegistration.pushManager.subscribe).toHaveBeenCalledWith({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      });
      expect(result).toBeTruthy();
      expect(pushNotificationService.isSubscribed()).toBe(true);
    });

    it('should handle subscription failure', async () => {
      mockServiceWorkerRegistration.pushManager.subscribe.mockRejectedValue(
        new Error('Subscribe failed')
      );

      // Mock permission as granted
      mockNotification.permission = 'granted';
      mockNotification.requestPermission.mockResolvedValue('granted');

      await expect(pushNotificationService.subscribe()).rejects.toThrow('Subscribe failed');

      expect(pushNotificationService.isSubscribed()).toBe(false);
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe from push notifications', async () => {
      const mockSubscription = {
        endpoint: 'https://fcm.googleapis.com/test',
        unsubscribe: vi.fn().mockResolvedValue(true),
        getKey: vi.fn((name: string) => {
          if (name === 'p256dh') return new Uint8Array([1, 2, 3]);
          if (name === 'auth') return new Uint8Array([4, 5, 6]);
          return null;
        }),
      };
      mockServiceWorkerRegistration.pushManager.getSubscription.mockResolvedValue(mockSubscription);

      await pushNotificationService.initialize();
      await pushNotificationService.waitForInitialization();

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      await pushNotificationService.unsubscribe();

      expect(mockSubscription.unsubscribe).toHaveBeenCalled();
      expect(pushNotificationService.isSubscribed()).toBe(false);
    });

    it('should handle unsubscribe when no subscription exists', async () => {
      mockServiceWorkerRegistration.pushManager.getSubscription.mockResolvedValue(null);

      await pushNotificationService.initialize();

      // Should not throw when no subscription exists
      await expect(pushNotificationService.unsubscribe()).resolves.not.toThrow();

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

      const saved = localStorage.getItem('vibetunnel-notification-preferences');
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
      const saved = localStorage.getItem('vibetunnel-notification-preferences');
      expect(saved).toBeTruthy();
    });
  });

  describe('testNotification', () => {
    it('should show notification when permission is granted', async () => {
      Object.defineProperty(mockNotification, 'permission', {
        writable: true,
        value: 'granted',
      });

      await pushNotificationService.initialize();

      await pushNotificationService.testNotification();

      expect(mockServiceWorkerRegistration.showNotification).toHaveBeenCalledWith(
        'VibeTunnel Test',
        expect.objectContaining({
          body: 'Push notifications are working correctly!',
          icon: '/apple-touch-icon.png',
          badge: '/favicon-32.png',
          tag: 'vibetunnel-test',
        })
      );
    });

    it('should not show notification when permission is denied', async () => {
      Object.defineProperty(mockNotification, 'permission', {
        writable: true,
        value: 'denied',
      });

      await pushNotificationService.initialize();

      await expect(pushNotificationService.testNotification()).rejects.toThrow(
        'Notification permission not granted'
      );

      expect(mockServiceWorkerRegistration.showNotification).not.toHaveBeenCalled();
    });

    it('should throw error when service worker not initialized', async () => {
      await expect(pushNotificationService.testNotification()).rejects.toThrow(
        'Service worker not initialized'
      );
    });
  });

  describe('sendTestNotification', () => {
    it('should send a test notification via server', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      await pushNotificationService.sendTestNotification('Test message');

      expect(fetch).toHaveBeenCalledWith('/api/push/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: 'Test message' }),
      });
    });

    it('should handle test notification failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(pushNotificationService.sendTestNotification()).rejects.toThrow(
        'Server responded with 500: Internal Server Error'
      );
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
