/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthClient } from './auth-client';
import { PushNotificationService } from './push-notification-service';

// Mock navigator.serviceWorker
const mockServiceWorker = {
  ready: Promise.resolve({
    pushManager: {
      getSubscription: vi.fn(),
      subscribe: vi.fn(),
    },
  }),
  register: vi.fn(),
};

// Mock PushManager
const mockPushManager = {
  getSubscription: vi.fn(),
  subscribe: vi.fn(),
};

describe('PushNotificationService', () => {
  let service: PushNotificationService;
  let mockAuthClient: AuthClient;
  let originalNavigator: Navigator;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;

    // Mock auth client
    mockAuthClient = {
      getAuthHeader: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
      fetch: vi.fn(),
    } as unknown as AuthClient;

    // Save original navigator
    originalNavigator = global.navigator;

    // Mock navigator with service worker and push support
    Object.defineProperty(global, 'navigator', {
      value: {
        serviceWorker: mockServiceWorker,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        vendor: 'Apple Computer, Inc.',
        standalone: false,
      },
      configurable: true,
    });

    // Mock window.Notification
    Object.defineProperty(global, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: vi.fn(),
      },
      configurable: true,
    });

    // Reset mocks
    mockPushManager.getSubscription.mockReset();
    mockPushManager.subscribe.mockReset();
    mockServiceWorker.register.mockReset();

    // Create service instance
    service = new PushNotificationService(mockAuthClient);
  });

  afterEach(() => {
    // Restore original navigator
    global.navigator = originalNavigator;
    vi.restoreAllMocks();
  });

  describe('isAvailable', () => {
    it('should return true when all requirements are met', () => {
      expect(service.isAvailable()).toBe(true);
    });

    it('should return false when serviceWorker is not available', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          ...global.navigator,
          serviceWorker: undefined,
        },
        configurable: true,
      });

      const serviceWithoutSW = new PushNotificationService(mockAuthClient);
      expect(serviceWithoutSW.isAvailable()).toBe(false);
    });

    it('should return false when PushManager is not available', () => {
      Object.defineProperty(global, 'PushManager', {
        value: undefined,
        configurable: true,
      });

      const serviceWithoutPush = new PushNotificationService(mockAuthClient);
      expect(serviceWithoutPush.isAvailable()).toBe(false);
    });

    it('should return false when Notification is not available', () => {
      Object.defineProperty(global, 'Notification', {
        value: undefined,
        configurable: true,
      });

      const serviceWithoutNotification = new PushNotificationService(mockAuthClient);
      expect(serviceWithoutNotification.isAvailable()).toBe(false);
    });
  });

  describe('iOS Safari PWA detection', () => {
    it('should detect iOS Safari in PWA mode', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          ...global.navigator,
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
          vendor: 'Apple Computer, Inc.',
          standalone: true,
        },
        configurable: true,
      });

      const iOSService = new PushNotificationService(mockAuthClient);
      expect(iOSService.isAvailable()).toBe(true);
    });

    it('should not be available on iOS Safari outside PWA', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          ...global.navigator,
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
          vendor: 'Apple Computer, Inc.',
          standalone: false,
        },
        configurable: true,
      });

      const iOSService = new PushNotificationService(mockAuthClient);
      expect(iOSService.isAvailable()).toBe(false);
    });

    it('should detect iPad Safari in PWA mode', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          ...global.navigator,
          userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)',
          vendor: 'Apple Computer, Inc.',
          standalone: true,
        },
        configurable: true,
      });

      const iPadService = new PushNotificationService(mockAuthClient);
      expect(iPadService.isAvailable()).toBe(true);
    });
  });

  describe('refreshVapidConfig', () => {
    it('should fetch and cache VAPID config', async () => {
      const mockVapidConfig = {
        publicKey: 'test-vapid-public-key',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockVapidConfig,
      });

      const config = await service.refreshVapidConfig();

      expect(fetchMock).toHaveBeenCalledWith('/api/push/vapid-public-key', {
        headers: { Authorization: 'Bearer test-token' },
      });
      expect(config).toEqual(mockVapidConfig);
    });

    it('should handle fetch errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      await expect(service.refreshVapidConfig()).rejects.toThrow('Network error');
    });

    it('should handle non-ok responses', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(service.refreshVapidConfig()).rejects.toThrow(
        'Failed to fetch VAPID public key: 500 Internal Server Error'
      );
    });
  });

  describe('getCurrentSubscription', () => {
    it('should return current subscription if exists', async () => {
      const mockSubscription = {
        endpoint: 'https://push.example.com/subscription/123',
        expirationTime: null,
        options: {},
      };

      mockPushManager.getSubscription.mockResolvedValueOnce(mockSubscription);

      const subscription = await service.getCurrentSubscription();

      expect(subscription).toEqual(mockSubscription);
      expect(mockPushManager.getSubscription).toHaveBeenCalled();
    });

    it('should return null if no subscription exists', async () => {
      mockPushManager.getSubscription.mockResolvedValueOnce(null);

      const subscription = await service.getCurrentSubscription();

      expect(subscription).toBeNull();
    });

    it('should handle service worker errors', async () => {
      // Override serviceWorker.ready to reject
      Object.defineProperty(global.navigator.serviceWorker, 'ready', {
        value: Promise.reject(new Error('Service worker failed')),
        configurable: true,
      });

      const serviceWithError = new PushNotificationService(mockAuthClient);
      await expect(serviceWithError.getCurrentSubscription()).rejects.toThrow(
        'Service worker failed'
      );
    });
  });

  describe('subscribe', () => {
    beforeEach(() => {
      // Set up successful VAPID config fetch
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ publicKey: 'test-vapid-key' }),
      });
    });

    it('should request permission and subscribe successfully', async () => {
      // Mock permission granted
      global.Notification.requestPermission.mockResolvedValueOnce('granted');
      global.Notification.permission = 'granted';

      // Mock successful subscription
      const mockSubscription = {
        endpoint: 'https://push.example.com/sub/456',
        toJSON: () => ({
          endpoint: 'https://push.example.com/sub/456',
          keys: { p256dh: 'key1', auth: 'key2' },
        }),
      };
      mockPushManager.subscribe.mockResolvedValueOnce(mockSubscription);

      // Mock successful server registration
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });
      mockAuthClient.fetch = mockFetch;

      const result = await service.subscribe();

      expect(global.Notification.requestPermission).toHaveBeenCalled();
      expect(mockPushManager.subscribe).toHaveBeenCalledWith({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      });
      expect(mockFetch).toHaveBeenCalledWith('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockSubscription.toJSON()),
      });
      expect(result).toEqual(mockSubscription);
    });

    it('should handle permission denied', async () => {
      global.Notification.requestPermission.mockResolvedValueOnce('denied');
      global.Notification.permission = 'denied';

      await expect(service.subscribe()).rejects.toThrow('Notification permission denied');
    });

    it('should handle subscription failure', async () => {
      global.Notification.requestPermission.mockResolvedValueOnce('granted');
      global.Notification.permission = 'granted';

      mockPushManager.subscribe.mockRejectedValueOnce(
        new Error('Failed to subscribe to push service')
      );

      await expect(service.subscribe()).rejects.toThrow('Failed to subscribe to push service');
    });

    it('should handle server registration failure', async () => {
      global.Notification.requestPermission.mockResolvedValueOnce('granted');
      global.Notification.permission = 'granted';

      const mockSubscription = {
        endpoint: 'https://push.example.com/sub/789',
        toJSON: () => ({ endpoint: 'https://push.example.com/sub/789' }),
      };
      mockPushManager.subscribe.mockResolvedValueOnce(mockSubscription);

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });
      mockAuthClient.fetch = mockFetch;

      await expect(service.subscribe()).rejects.toThrow(
        'Failed to register subscription with server: 400 Bad Request'
      );
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe successfully', async () => {
      const mockSubscription = {
        endpoint: 'https://push.example.com/sub/999',
        unsubscribe: vi.fn().mockResolvedValueOnce(true),
        toJSON: () => ({ endpoint: 'https://push.example.com/sub/999' }),
      };

      mockPushManager.getSubscription.mockResolvedValueOnce(mockSubscription);

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });
      mockAuthClient.fetch = mockFetch;

      await service.unsubscribe();

      expect(mockSubscription.unsubscribe).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: mockSubscription.endpoint }),
      });
    });

    it('should handle case when no subscription exists', async () => {
      mockPushManager.getSubscription.mockResolvedValueOnce(null);

      // Should not throw
      await expect(service.unsubscribe()).resolves.toBeUndefined();
    });

    it('should continue even if server unregistration fails', async () => {
      const mockSubscription = {
        endpoint: 'https://push.example.com/sub/fail',
        unsubscribe: vi.fn().mockResolvedValueOnce(true),
        toJSON: () => ({ endpoint: 'https://push.example.com/sub/fail' }),
      };

      mockPushManager.getSubscription.mockResolvedValueOnce(mockSubscription);

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
      });
      mockAuthClient.fetch = mockFetch;

      // Should not throw, just log error
      await expect(service.unsubscribe()).resolves.toBeUndefined();
      expect(mockSubscription.unsubscribe).toHaveBeenCalled();
    });
  });

  describe('getServerPushStatus', () => {
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

      const status = await service.getServerPushStatus();

      expect(fetchMock).toHaveBeenCalledWith('/api/push/status', {
        headers: { Authorization: 'Bearer test-token' },
      });
      expect(status).toEqual(mockStatus);
    });

    it('should handle fetch errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network failure'));

      await expect(service.getServerPushStatus()).rejects.toThrow('Network failure');
    });
  });

  describe('urlBase64ToUint8Array', () => {
    it('should convert base64 URL-safe string to Uint8Array', () => {
      // This is a simplified test - in reality you'd use actual VAPID keys
      const base64 = 'SGVsbG8gV29ybGQ'; // "Hello World" in base64
      const result = service.urlBase64ToUint8Array(base64);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle URL-safe base64 with padding', () => {
      const base64WithDashes = 'SGVs-bG8gV29y_bGQ=';
      const result = service.urlBase64ToUint8Array(base64WithDashes);

      expect(result).toBeInstanceOf(Uint8Array);
    });
  });
});
