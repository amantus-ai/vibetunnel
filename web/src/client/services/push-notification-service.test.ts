/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PushNotificationService } from './push-notification-service';

// Type for the mocked Notification global
type MockNotification = {
  permission: NotificationPermission;
  requestPermission: ReturnType<typeof vi.fn>;
};

// Mock the auth client
vi.mock('./auth-client', () => ({
  authClient: {
    getAuthHeader: vi.fn(() => ({})), // Return empty object, no auth header
  },
}));

// Mock PushManager
const mockPushManager = {
  getSubscription: vi.fn(),
  subscribe: vi.fn(),
};

// Mock service worker registration
const mockServiceWorkerRegistration = {
  pushManager: mockPushManager,
  showNotification: vi.fn(),
  getNotifications: vi.fn(),
};

// Mock navigator.serviceWorker
const mockServiceWorker = {
  ready: Promise.resolve(mockServiceWorkerRegistration),
  register: vi.fn().mockResolvedValue(mockServiceWorkerRegistration),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

describe('PushNotificationService', () => {
  let service: PushNotificationService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;

    // Mock navigator with service worker and push support
    const mockNavigator = {
      serviceWorker: mockServiceWorker,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      vendor: 'Apple Computer, Inc.',
      standalone: false,
    };
    vi.stubGlobal('navigator', mockNavigator);

    // Mock window.Notification
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission: vi.fn(),
    });

    // Mock window.PushManager
    vi.stubGlobal('PushManager', function PushManager() {});

    // Mock window.matchMedia
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    );

    // Reset mocks
    mockPushManager.getSubscription.mockReset();
    mockPushManager.subscribe.mockReset();
    mockServiceWorker.register.mockReset();
    vi.clearAllMocks();

    // Create service instance
    service = new PushNotificationService();
  });

  afterEach(() => {
    // Restore all mocks first
    vi.restoreAllMocks();
    // Then restore all global stubs
    vi.unstubAllGlobals();
  });

  describe('isSupported', () => {
    it('should return true when all requirements are met', () => {
      expect(service.isSupported()).toBe(true);
    });

    it('should return false when serviceWorker is not available', () => {
      // Create a new mock navigator without serviceWorker
      const navigatorWithoutSW = {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        vendor: 'Apple Computer, Inc.',
        standalone: false,
        // Don't include serviceWorker property at all
      };
      vi.stubGlobal('navigator', navigatorWithoutSW);

      const serviceWithoutSW = new PushNotificationService();
      expect(serviceWithoutSW.isSupported()).toBe(false);
    });

    it('should return false when PushManager is not available', () => {
      // Remove PushManager from window
      const originalPushManager = window.PushManager;
      delete (window as unknown as Record<string, unknown>).PushManager;

      const serviceWithoutPush = new PushNotificationService();
      expect(serviceWithoutPush.isSupported()).toBe(false);

      // Restore PushManager
      (window as unknown as Record<string, unknown>).PushManager = originalPushManager;
    });

    it('should return false when Notification is not available', () => {
      // Remove Notification from window
      const originalNotification = window.Notification;
      delete (window as unknown as Record<string, unknown>).Notification;

      const serviceWithoutNotification = new PushNotificationService();
      expect(serviceWithoutNotification.isSupported()).toBe(false);

      // Restore Notification
      (window as unknown as Record<string, unknown>).Notification = originalNotification;
    });
  });

  describe('iOS Safari PWA detection', () => {
    it('should detect iOS Safari in PWA mode', () => {
      const iOSNavigator = {
        serviceWorker: mockServiceWorker,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        vendor: 'Apple Computer, Inc.',
        standalone: true,
      };
      vi.stubGlobal('navigator', iOSNavigator);

      // Mock matchMedia to return true for standalone mode
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({
          matches: query === '(display-mode: standalone)',
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }))
      );

      const iOSService = new PushNotificationService();
      expect(iOSService.isSupported()).toBe(true);
    });

    it('should not be available on iOS Safari outside PWA', () => {
      const iOSNavigator = {
        serviceWorker: mockServiceWorker,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        vendor: 'Apple Computer, Inc.',
        standalone: false,
      };
      vi.stubGlobal('navigator', iOSNavigator);

      // Mock matchMedia to return false for standalone mode
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }))
      );

      const iOSService = new PushNotificationService();
      expect(iOSService.isSupported()).toBe(false);
    });

    it('should detect iPad Safari in PWA mode', () => {
      const iPadNavigator = {
        serviceWorker: mockServiceWorker,
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)',
        vendor: 'Apple Computer, Inc.',
        standalone: true,
      };
      vi.stubGlobal('navigator', iPadNavigator);

      // Mock matchMedia to return true for standalone mode
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({
          matches: query === '(display-mode: standalone)',
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }))
      );

      const iPadService = new PushNotificationService();
      expect(iPadService.isSupported()).toBe(true);
    });
  });

  describe('refreshVapidConfig', () => {
    it('should fetch and cache VAPID config', async () => {
      const mockVapidConfig = {
        publicKey: 'test-vapid-public-key',
        enabled: true,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockVapidConfig,
      });

      await service.refreshVapidConfig();

      expect(fetchMock).toHaveBeenCalledWith('/api/push/vapid-public-key', {
        headers: {},
      });
    });

    it('should handle fetch errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      // refreshVapidConfig doesn't throw, it logs errors
      await expect(service.refreshVapidConfig()).resolves.toBeUndefined();
      // No error thrown, just logged
    });

    it('should handle non-ok responses', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      // refreshVapidConfig doesn't throw, it logs errors
      await expect(service.refreshVapidConfig()).resolves.toBeUndefined();
      // No error thrown, just logged
    });
  });

  describe('getSubscription', () => {
    it('should return current subscription if exists', async () => {
      const mockSubscription = {
        endpoint: 'https://push.example.com/subscription/123',
        expirationTime: null,
        getKey: (name: string) => {
          if (name === 'p256dh') return new Uint8Array([1, 2, 3]);
          if (name === 'auth') return new Uint8Array([4, 5, 6]);
          return null;
        },
      };

      mockPushManager.getSubscription.mockResolvedValue(mockSubscription);

      // Mock VAPID config fetch
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ publicKey: 'test-vapid-key', enabled: true }),
      });

      await service.initialize();
      const subscription = service.getSubscription();

      expect(subscription).toBeTruthy();
      expect(subscription?.endpoint).toBe('https://push.example.com/subscription/123');
    });

    it('should return null if no subscription exists', async () => {
      mockPushManager.getSubscription.mockResolvedValueOnce(null);

      // Mock VAPID config fetch
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ publicKey: 'test-vapid-key', enabled: true }),
      });

      await service.initialize();
      const subscription = service.getSubscription();

      expect(subscription).toBeNull();
    });

    it('should handle service worker errors', async () => {
      // Mock fetch to fail for this test
      fetchMock.mockRejectedValueOnce(new Error('Fetch failed'));

      // Create a rejected promise but handle it immediately to avoid unhandled rejection
      const rejectedPromise = Promise.reject(new Error('Service worker failed'));
      rejectedPromise.catch(() => {}); // Handle rejection to prevent warning

      const failingServiceWorker = {
        ready: rejectedPromise,
        register: vi.fn(),
      };

      vi.stubGlobal('navigator', {
        serviceWorker: failingServiceWorker,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        vendor: 'Apple Computer, Inc.',
        standalone: false,
      });

      const serviceWithError = new PushNotificationService();

      // initialize() doesn't throw, it catches errors
      await serviceWithError.initialize();
      expect(serviceWithError.getSubscription()).toBeNull();
    });
  });

  describe('subscribe', () => {
    let subscribeService: PushNotificationService;

    beforeEach(async () => {
      // Create a new service instance for subscribe tests
      subscribeService = new PushNotificationService();

      // Set up successful VAPID config fetch
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ publicKey: 'test-vapid-key', enabled: true }),
      });

      // Initialize the service to set up service worker registration
      await subscribeService.initialize();
    });

    it('should request permission and subscribe successfully', async () => {
      // Mock permission as default initially, so it will request permission
      (global.Notification as MockNotification).permission = 'default';
      (global.Notification as MockNotification).requestPermission.mockResolvedValueOnce('granted');

      // Mock successful subscription
      const mockSubscription = {
        endpoint: 'https://push.example.com/sub/456',
        getKey: (name: string) => {
          if (name === 'p256dh') return new Uint8Array([1, 2, 3]);
          if (name === 'auth') return new Uint8Array([4, 5, 6]);
          return null;
        },
        toJSON: () => ({
          endpoint: 'https://push.example.com/sub/456',
          keys: { p256dh: 'key1', auth: 'key2' },
        }),
      };
      mockPushManager.subscribe.mockResolvedValueOnce(mockSubscription);

      // Mock successful server registration
      // The fetch mock must be set up AFTER the initialization fetch in beforeEach
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
        headers: new Headers(),
      });

      const result = await subscribeService.subscribe();

      expect((global.Notification as MockNotification).requestPermission).toHaveBeenCalled();
      expect(mockPushManager.subscribe).toHaveBeenCalledWith({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      });
      expect(fetchMock).toHaveBeenCalledWith('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('endpoint'),
      });
      // Result is converted to our interface format, not the raw subscription
      expect(result).toBeTruthy();
      expect(result?.endpoint).toBe('https://push.example.com/sub/456');
    });

    it('should handle permission denied', async () => {
      (global.Notification as MockNotification).requestPermission.mockResolvedValueOnce('denied');
      (global.Notification as MockNotification).permission = 'denied';

      await expect(subscribeService.subscribe()).rejects.toThrow('Notification permission denied');
    });

    it('should handle subscription failure', async () => {
      (global.Notification as MockNotification).requestPermission.mockResolvedValueOnce('granted');
      (global.Notification as MockNotification).permission = 'granted';

      mockPushManager.subscribe.mockRejectedValueOnce(
        new Error('Failed to subscribe to push service')
      );

      await expect(subscribeService.subscribe()).rejects.toThrow(
        'Failed to subscribe to push service'
      );
    });

    it('should handle server registration failure', async () => {
      (global.Notification as MockNotification).requestPermission.mockResolvedValueOnce('granted');
      (global.Notification as MockNotification).permission = 'granted';

      const mockSubscription = {
        endpoint: 'https://push.example.com/sub/789',
        getKey: (name: string) => {
          if (name === 'p256dh') return new Uint8Array([1, 2, 3]);
          if (name === 'auth') return new Uint8Array([4, 5, 6]);
          return null;
        },
        toJSON: () => ({ endpoint: 'https://push.example.com/sub/789' }),
      };
      mockPushManager.subscribe.mockResolvedValueOnce(mockSubscription);

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });

      await expect(subscribeService.subscribe()).rejects.toThrow(
        'Server responded with 400: Bad Request'
      );
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe successfully', async () => {
      // Set up a subscription
      const mockSubscription = {
        endpoint: 'https://push.example.com/sub/999',
        unsubscribe: vi.fn().mockResolvedValueOnce(true),
        getKey: (name: string) => {
          if (name === 'p256dh') return new Uint8Array([1, 2, 3]);
          if (name === 'auth') return new Uint8Array([4, 5, 6]);
          return null;
        },
        toJSON: () => ({ endpoint: 'https://push.example.com/sub/999' }),
      };

      // Mock getting existing subscription on init
      mockPushManager.getSubscription.mockResolvedValueOnce(mockSubscription);

      // Mock VAPID config
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ publicKey: 'test-vapid-key', enabled: true }),
      });

      // Initialize to pick up the subscription
      await service.initialize();

      // Mock successful server unregistration
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await service.unsubscribe();

      expect(mockSubscription.unsubscribe).toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    });

    it('should handle case when no subscription exists', async () => {
      // Mock VAPID config
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ publicKey: 'test-vapid-key', enabled: true }),
      });

      await service.initialize();

      // Should not throw
      await expect(service.unsubscribe()).resolves.toBeUndefined();
    });

    it('should continue even if server unregistration fails', async () => {
      const mockSubscription = {
        endpoint: 'https://push.example.com/sub/fail',
        unsubscribe: vi.fn().mockResolvedValueOnce(true),
        getKey: (name: string) => {
          if (name === 'p256dh') return new Uint8Array([1, 2, 3]);
          if (name === 'auth') return new Uint8Array([4, 5, 6]);
          return null;
        },
        toJSON: () => ({ endpoint: 'https://push.example.com/sub/fail' }),
      };

      // Mock getting existing subscription on init
      mockPushManager.getSubscription.mockResolvedValueOnce(mockSubscription);

      // Mock VAPID config
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ publicKey: 'test-vapid-key', enabled: true }),
      });

      // Initialize to pick up the subscription
      await service.initialize();

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      // Should not throw - unsubscribe continues even if server fails
      await expect(service.unsubscribe()).resolves.toBeUndefined();

      // But subscription should still be unsubscribed locally
      expect(mockSubscription.unsubscribe).toHaveBeenCalled();
    });
  });

  describe('getServerStatus', () => {
    it('should fetch server push status', async () => {
      const mockStatus = {
        enabled: true,
        vapidPublicKey: 'server-vapid-key',
        subscriptionCount: 42,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatus,
      });

      const status = await service.getServerStatus();

      expect(fetchMock).toHaveBeenCalledWith('/api/push/status');
      expect(status).toEqual(mockStatus);
    });

    it('should handle fetch errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network failure'));

      await expect(service.getServerStatus()).rejects.toThrow('Network failure');
    });
  });
});
