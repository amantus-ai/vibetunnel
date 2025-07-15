// @vitest-environment happy-dom
import { fixture, html } from '@open-wc/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppPreferences } from './unified-settings';
import './unified-settings';
import type { UnifiedSettings } from './unified-settings';

// Mock modules
vi.mock('@/client/services/push-notification-service', () => ({
  pushNotificationService: {
    isSupported: () => false,
    requestPermission: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    waitForInitialization: vi.fn().mockResolvedValue(undefined),
    getPermission: vi.fn().mockReturnValue('default'),
    getSubscription: vi.fn().mockReturnValue(null),
    loadPreferences: vi.fn().mockReturnValue({
      enabled: false,
      sessionExit: true,
      sessionStart: false,
      sessionError: true,
      systemAlerts: true,
      soundEnabled: true,
      vibrationEnabled: true,
    }),
    onPermissionChange: vi.fn(() => () => {}),
    onSubscriptionChange: vi.fn(() => () => {}),
    savePreferences: vi.fn(),
    testNotification: vi.fn().mockResolvedValue(undefined),
    isSubscribed: vi.fn().mockReturnValue(false),
  },
}));

vi.mock('@/client/services/auth-service', () => ({
  authService: {
    onPermissionChange: vi.fn(() => () => {}),
    onSubscriptionChange: vi.fn(() => () => {}),
  },
}));

vi.mock('@/client/services/responsive-observer', () => ({
  responsiveObserver: {
    getCurrentState: () => ({ isMobile: false, isNarrow: false }),
    subscribe: vi.fn(() => () => {}),
  },
}));

vi.mock('@/client/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock fetch for API calls
global.fetch = vi.fn();

// Mock WebSocket
class MockWebSocket {
  url: string;
  readyState = 1; // OPEN
  onopen?: (event: Event) => void;
  onmessage?: (event: MessageEvent) => void;
  onerror?: (event: Event) => void;
  onclose?: (event: CloseEvent) => void;
  static instances: MockWebSocket[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    // Simulate open event
    setTimeout(() => {
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 0);
  }

  send(_data: string) {
    // Mock send
  }

  close() {
    if (this.onclose) {
      this.onclose(new CloseEvent('close'));
    }
  }

  // Helper to simulate receiving a message
  simulateMessage(data: unknown) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }));
    }
  }

  static reset() {
    MockWebSocket.instances = [];
  }
}

// Replace global WebSocket
(global as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;

describe('UnifiedSettings - Repository Path Bidirectional Sync', () => {
  let mockWebSocketSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.reset();
    localStorage.clear();
    mockWebSocketSend = vi.fn();

    // Mock default fetch response
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        repositoryBasePath: '~/',
        serverConfigured: false,
      }),
    });
  });

  describe('Web to Mac sync', () => {
    it('should send repository path updates through WebSocket when not server-configured', async () => {
      const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);

      // Make component visible
      el.visible = true;

      // Wait for WebSocket connection
      await new Promise((resolve) => setTimeout(resolve, 100));
      await el.updateComplete;

      // Get the WebSocket instance and override send method
      const ws = MockWebSocket.instances[0];
      expect(ws).toBeTruthy();
      ws.send = mockWebSocketSend;

      // Find the repository path input
      const input = el.querySelector('input[placeholder="~/"]') as HTMLInputElement;
      expect(input).toBeTruthy();

      // Simulate user changing the path
      input.value = '/new/repository/path';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify WebSocket message was sent
      expect(mockWebSocketSend).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'update-repository-path',
          path: '/new/repository/path',
        })
      );
    });

    it('should NOT send updates when server-configured', async () => {
      // Mock server response with serverConfigured = true
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({
          repositoryBasePath: '/Users/test/Projects',
          serverConfigured: true,
        }),
      });

      const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);

      // Make component visible
      el.visible = true;

      // Wait for WebSocket connection
      await new Promise((resolve) => setTimeout(resolve, 100));
      await el.updateComplete;

      // Get the WebSocket instance and override send method
      const ws = MockWebSocket.instances[0];
      expect(ws).toBeTruthy();
      ws.send = mockWebSocketSend;

      // Try to change the path (should be blocked)
      (
        el as UnifiedSettings & { handleAppPreferenceChange: (key: string, value: string) => void }
      ).handleAppPreferenceChange('repositoryBasePath', '/different/path');

      // Wait for any potential send
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify NO WebSocket message was sent
      expect(mockWebSocketSend).not.toHaveBeenCalled();
    });

    it('should handle WebSocket not connected gracefully', async () => {
      const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);

      // Make component visible
      el.visible = true;

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 100));
      await el.updateComplete;

      // Get the WebSocket instance and simulate closed state
      const ws = MockWebSocket.instances[0];
      expect(ws).toBeTruthy();
      ws.readyState = MockWebSocket.CLOSED;
      ws.send = mockWebSocketSend;

      // Find and change the input
      const input = el.querySelector('input[placeholder="~/"]') as HTMLInputElement;
      input.value = '/new/path';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify no send was attempted on closed WebSocket
      expect(mockWebSocketSend).not.toHaveBeenCalled();
    });
  });

  describe('Mac to Web sync', () => {
    it('should update UI when receiving path update from Mac', async () => {
      const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);

      // Make component visible
      el.visible = true;

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 100));
      await el.updateComplete;

      // Get the WebSocket instance
      const ws = MockWebSocket.instances[0];
      expect(ws).toBeTruthy();

      // Simulate Mac sending a config update
      ws.simulateMessage({
        type: 'config',
        data: {
          repositoryBasePath: '/mac/updated/path',
          serverConfigured: false,
        },
      });

      // Wait for the update to process
      await new Promise((resolve) => setTimeout(resolve, 50));
      await el.updateComplete;

      // Check that the input value updated
      const input = el.querySelector('input[placeholder="~/"]') as HTMLInputElement;
      expect(input?.value).toBe('/mac/updated/path');
      expect(input?.disabled).toBe(false); // Still editable since not server-configured
    });

    it('should update sync status text when serverConfigured changes', async () => {
      const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);

      // Make component visible
      el.visible = true;

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 100));
      await el.updateComplete;

      // Initially not server-configured
      const description = el.querySelector('p.text-xs')?.textContent;
      expect(description).toContain('Default directory for new sessions');

      // Get the WebSocket instance
      const ws = MockWebSocket.instances[0];

      // Simulate Mac enabling server configuration
      ws.simulateMessage({
        type: 'config',
        data: {
          repositoryBasePath: '/mac/controlled/path',
          serverConfigured: true,
        },
      });

      // Wait for update
      await new Promise((resolve) => setTimeout(resolve, 50));
      await el.updateComplete;

      // Check updated text
      const descriptions = Array.from(el.querySelectorAll('p.text-xs') || []);
      const repoDescription = descriptions.find((p) =>
        p.textContent?.includes('This path is synced with the VibeTunnel Mac app')
      );
      expect(repoDescription).toBeTruthy();

      // Check lock icon appeared
      const lockIconContainer = el.querySelector('[title="Synced with Mac app"]');
      expect(lockIconContainer).toBeTruthy();
    });
  });
});

describe('UnifiedSettings - Repository Path Server Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.reset();
    localStorage.clear();

    // Mock default fetch response
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        repositoryBasePath: '~/',
        serverConfigured: false,
      }),
    });
  });

  afterEach(() => {
    // Clean up any remaining WebSocket instances
    MockWebSocket.instances.forEach((ws) => {
      if (ws.onclose) {
        ws.close();
      }
    });
  });

  it('should show repository path as editable when not server-configured', async () => {
    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);

    // Make component visible
    el.visible = true;

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    // Find the repository base path input
    const input = el.querySelector('input[placeholder="~/"]') as HTMLInputElement | null;

    expect(input).toBeTruthy();
    expect(input?.disabled).toBe(false);
    expect(input?.readOnly).toBe(false);
    expect(input?.classList.contains('opacity-60')).toBe(false);
    expect(input?.classList.contains('cursor-not-allowed')).toBe(false);
  });

  it('should show repository path as read-only when server-configured', async () => {
    // Mock server response with serverConfigured = true
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        repositoryBasePath: '/Users/test/Projects',
        serverConfigured: true,
      }),
    });

    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);

    // Make component visible
    el.visible = true;

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    // Find the repository base path input
    const input = el.querySelector('input[placeholder="~/"]') as HTMLInputElement | null;

    expect(input).toBeTruthy();
    expect(input?.disabled).toBe(true);
    expect(input?.readOnly).toBe(true);
    expect(input?.classList.contains('opacity-60')).toBe(true);
    expect(input?.classList.contains('cursor-not-allowed')).toBe(true);
    expect(input?.value).toBe('/Users/test/Projects');
  });

  it('should display lock icon and message when server-configured', async () => {
    // Mock server response with serverConfigured = true
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        repositoryBasePath: '/Users/test/Projects',
        serverConfigured: true,
      }),
    });

    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);

    // Make component visible
    el.visible = true;

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    // Check for the lock icon
    const lockIcon = el.querySelector('svg');
    expect(lockIcon).toBeTruthy();

    // Check for the descriptive text
    const descriptions = Array.from(el.querySelectorAll('p.text-xs') || []);
    const repoDescription = descriptions.find((p) =>
      p.textContent?.includes('This path is managed by the VibeTunnel Mac app')
    );
    expect(repoDescription).toBeTruthy();
  });

  it('should update repository path via WebSocket when server sends update', async () => {
    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);

    // Make component visible
    el.visible = true;

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    // Get the WebSocket instance created by the component
    const ws = MockWebSocket.instances[0];
    expect(ws).toBeTruthy();

    // Simulate server sending a config update
    ws.simulateMessage({
      type: 'config',
      data: {
        repositoryBasePath: '/Users/new/path',
        serverConfigured: true,
      },
    });

    // Wait for the update to process
    await new Promise((resolve) => setTimeout(resolve, 50));
    await el.updateComplete;

    // Check that the input value updated
    const input = el.querySelector('input[placeholder="~/"]') as HTMLInputElement | null;
    expect(input?.value).toBe('/Users/new/path');
    expect(input?.disabled).toBe(true);
  });

  it('should ignore repository path changes when server-configured', async () => {
    // Mock server response with serverConfigured = true
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        repositoryBasePath: '/Users/test/Projects',
        serverConfigured: true,
      }),
    });

    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    // Try to change the repository path
    const originalPath = '/Users/test/Projects';
    (
      el as UnifiedSettings & { handleAppPreferenceChange: (key: string, value: string) => void }
    ).handleAppPreferenceChange('repositoryBasePath', '/Users/different/path');

    // Wait for any updates
    await new Promise((resolve) => setTimeout(resolve, 50));
    await el.updateComplete;

    // Verify the path didn't change
    const preferences = (el as UnifiedSettings & { appPreferences: AppPreferences }).appPreferences;
    expect(preferences.repositoryBasePath).toBe(originalPath);
  });

  it('should reconnect WebSocket after disconnection', async () => {
    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeTruthy();

    // Clear instances before close to track new connection
    MockWebSocket.instances = [];

    // Simulate WebSocket close
    ws.close();

    // Wait for reconnection timeout (5 seconds in the code, but we'll use a shorter time for testing)
    await new Promise((resolve) => setTimeout(resolve, 5100));

    // Check that a new WebSocket was created
    expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    const newWs = MockWebSocket.instances[0];
    expect(newWs).toBeTruthy();
    expect(newWs).not.toBe(ws);
  });

  it('should handle WebSocket message parsing errors gracefully', async () => {
    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeTruthy();

    // Send invalid JSON
    if (ws.onmessage) {
      ws.onmessage(new MessageEvent('message', { data: 'invalid json' }));
    }

    // Should not throw and component should still work
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(el).toBeTruthy();
  });

  it('should save preferences when updated from server', async () => {
    // Mock server response with non-server-configured state initially
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        repositoryBasePath: '~/',
        serverConfigured: false,
      }),
    });

    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);

    // Make component visible
    el.visible = true;

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    // Get the WebSocket instance
    const ws = MockWebSocket.instances[0];
    expect(ws).toBeTruthy();

    // Directly check that the values get updated
    const initialPath = (el as UnifiedSettings & { appPreferences: AppPreferences }).appPreferences
      .repositoryBasePath;
    expect(initialPath).toBe('~/');

    // Simulate server update that changes to server-configured with new path
    ws.simulateMessage({
      type: 'config',
      data: {
        repositoryBasePath: '/Users/updated/path',
        serverConfigured: true,
      },
    });

    // Wait for the update to process
    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    // Verify the path was updated
    const updatedPath = (el as UnifiedSettings & { appPreferences: AppPreferences }).appPreferences
      .repositoryBasePath;
    expect(updatedPath).toBe('/Users/updated/path');

    // Verify the server configured state changed
    const isServerConfigured = (el as UnifiedSettings & { isServerConfigured: boolean })
      .isServerConfigured;
    expect(isServerConfigured).toBe(true);
  });
});
