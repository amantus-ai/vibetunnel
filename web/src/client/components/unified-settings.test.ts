// @vitest-environment happy-dom
import { fixture, html } from '@open-wc/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockWebSocket } from '@/test/utils/lit-test-utils';
import type { AppPreferences } from './unified-settings';
import './unified-settings';
import type { UnifiedSettings } from './unified-settings';

// Mock modules
vi.mock('@/client/services/push-notification-service', () => ({
  pushNotificationService: {
    isSupported: vi.fn(() => false),
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

describe('UnifiedSettings - Repository Path Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('should show repository path as always editable', async () => {
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

  it('should save repository path changes to localStorage', async () => {
    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);

    // Make component visible
    el.visible = true;

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    // Change the repository path
    const newPath = '/Users/test/new-path';
    (
      el as UnifiedSettings & { handleAppPreferenceChange: (key: string, value: string) => void }
    ).handleAppPreferenceChange('repositoryBasePath', newPath);

    // Wait for any updates
    await new Promise((resolve) => setTimeout(resolve, 50));
    await el.updateComplete;

    // Verify the path was saved
    const preferences = (el as UnifiedSettings & { appPreferences: AppPreferences }).appPreferences;
    expect(preferences.repositoryBasePath).toBe(newPath);

    // Verify it was saved to localStorage
    const savedPrefs = JSON.parse(localStorage.getItem('vibetunnel_app_preferences') || '{}');
    expect(savedPrefs.repositoryBasePath).toBe(newPath);
  });

  it('should load repository path from localStorage on initialization', async () => {
    // Set a value in localStorage
    const savedPath = '/Users/saved/path';
    localStorage.setItem(
      'vibetunnel_app_preferences',
      JSON.stringify({ repositoryBasePath: savedPath })
    );

    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);

    // Make component visible
    el.visible = true;

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    // Verify the path was loaded from localStorage
    const preferences = (el as UnifiedSettings & { appPreferences: AppPreferences }).appPreferences;
    expect(preferences.repositoryBasePath).toBe(savedPath);
  });

  it('should persist repository path changes across component lifecycle', async () => {
    // Create first instance and set a path
    const el1 = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);
    const newPath = '/Users/test/lifecycle-path';
    (
      el1 as UnifiedSettings & { handleAppPreferenceChange: (key: string, value: string) => void }
    ).handleAppPreferenceChange('repositoryBasePath', newPath);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Create second instance and verify it loads the saved path
    const el2 = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await el2.updateComplete;

    const preferences = (el2 as UnifiedSettings & { appPreferences: AppPreferences })
      .appPreferences;
    expect(preferences.repositoryBasePath).toBe(newPath);
  });

  it('should not overwrite localStorage path when loading server config', async () => {
    // Set a value in localStorage
    const localPath = '/Users/local/path';
    localStorage.setItem(
      'vibetunnel_app_preferences',
      JSON.stringify({ repositoryBasePath: localPath })
    );

    // Mock server response that should NOT override the local path
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        quickStartCommands: [{ name: 'test', command: 'test' }],
      }),
    });

    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);

    // Make component visible
    el.visible = true;

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    // Verify the path from localStorage was preserved
    const path = (el as UnifiedSettings & { appPreferences: AppPreferences }).appPreferences
      .repositoryBasePath;
    expect(path).toBe(localPath);
  });
});

// Mock the RepositoryService import at the module level
vi.mock('@/client/services/repository-service');

describe('UnifiedSettings - Repository Discovery', () => {
  let mockAuthClient: { getAuthHeader: ReturnType<typeof vi.fn> };
  let mockRepositoryService: { discoverRepositories: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();

    // Mock auth client
    mockAuthClient = {
      getAuthHeader: vi.fn().mockReturnValue({ Authorization: 'Bearer test-token' }),
    };

    // Mock repository service response
    mockRepositoryService = {
      discoverRepositories: vi.fn(),
    };

    // Set up the mocked RepositoryService
    const { RepositoryService } = await import('@/client/services/repository-service');
    (RepositoryService as ReturnType<typeof vi.fn>).mockImplementation(() => mockRepositoryService);

    // Mock default fetch response
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        repositoryBasePath: '~/',
        serverConfigured: false,
      }),
    });
  });

  it('should trigger repository discovery when settings are opened', async () => {
    // Mock repository discovery to return some repositories
    mockRepositoryService.discoverRepositories.mockResolvedValue([
      { name: 'repo1', path: '/path/to/repo1' },
      { name: 'repo2', path: '/path/to/repo2' },
    ]);

    const el = await fixture<UnifiedSettings>(html`
      <unified-settings .authClient=${mockAuthClient}></unified-settings>
    `);

    // Initially not visible
    expect(el.visible).toBe(false);

    // Make component visible
    el.visible = true;
    await el.updateComplete;

    // Wait for discovery to complete
    await new Promise((resolve) => setTimeout(resolve, 200));
    await el.updateComplete;

    // Check that repository count is displayed
    const repositoryCountElement = el.querySelector('#repository-status');
    expect(repositoryCountElement?.textContent).toContain('2 repositories found');
  });

  it('should show refresh button for repository discovery', async () => {
    const el = await fixture<UnifiedSettings>(html`
      <unified-settings .authClient=${mockAuthClient}></unified-settings>
    `);

    el.visible = true;
    await el.updateComplete;

    // Find refresh button
    const refreshButton = el.querySelector('button[title="Refresh repository list"]');
    expect(refreshButton).toBeTruthy();
    expect(refreshButton?.querySelector('svg')).toBeTruthy();
  });

  it('should refresh repositories when refresh button is clicked', async () => {
    // Mock initial discovery returns 2 repos
    mockRepositoryService.discoverRepositories
      .mockResolvedValueOnce([
        { name: 'repo1', path: '/path/to/repo1' },
        { name: 'repo2', path: '/path/to/repo2' },
      ])
      .mockResolvedValueOnce([
        { name: 'repo1', path: '/path/to/repo1' },
        { name: 'repo2', path: '/path/to/repo2' },
        { name: 'repo3', path: '/path/to/repo3' },
      ]);

    const el = await fixture<UnifiedSettings>(html`
      <unified-settings .authClient=${mockAuthClient}></unified-settings>
    `);

    el.visible = true;
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 200));
    await el.updateComplete;

    // Initial count should be 2
    let repositoryCountElement = el.querySelector('#repository-status');
    expect(repositoryCountElement?.textContent).toContain('2 repositories found');

    // Click refresh button
    const refreshButton = el.querySelector(
      'button[title="Refresh repository list"]'
    ) as HTMLButtonElement;
    refreshButton.click();

    await new Promise((resolve) => setTimeout(resolve, 200));
    await el.updateComplete;

    // Count should now be 3
    repositoryCountElement = el.querySelector('#repository-status');
    expect(repositoryCountElement?.textContent).toContain('3 repositories found');
  });

  it('should show scanning state during discovery', async () => {
    // Mock slow discovery
    mockRepositoryService.discoverRepositories.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 500))
    );

    const el = await fixture<UnifiedSettings>(html`
      <unified-settings .authClient=${mockAuthClient}></unified-settings>
    `);

    el.visible = true;
    await el.updateComplete;

    // Click refresh button
    const refreshButton = el.querySelector(
      'button[title="Refresh repository list"]'
    ) as HTMLButtonElement;
    refreshButton.click();
    await el.updateComplete;

    // Should show scanning state
    let scanningText = el.querySelector('#repository-status');
    expect(scanningText?.textContent).toContain('Scanning...');

    // Button should be disabled
    expect(refreshButton.disabled).toBe(true);

    // Wait for discovery to complete
    await new Promise((resolve) => setTimeout(resolve, 700));
    await el.updateComplete;

    // Re-query the element after updates
    scanningText = el.querySelector('#repository-status');
    // Should show result
    expect(scanningText?.textContent).toContain('0 repositories found');
    expect(refreshButton.disabled).toBe(false);
  });

  it('should trigger repository discovery when repository path changes', async () => {
    mockRepositoryService.discoverRepositories
      .mockResolvedValueOnce([{ name: 'repo1', path: '/path/to/repo1' }])
      .mockResolvedValueOnce([
        { name: 'other-repo1', path: '/other/path/repo1' },
        { name: 'other-repo2', path: '/other/path/repo2' },
      ]);

    const el = await fixture<UnifiedSettings>(html`
      <unified-settings .authClient=${mockAuthClient}></unified-settings>
    `);

    el.visible = true;
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 200));
    await el.updateComplete;

    // Initial count
    let repositoryCountElement = el.querySelector('#repository-status');
    expect(repositoryCountElement?.textContent).toContain('1 repositories found');

    // Change repository path
    const input = el.querySelector('input[placeholder="~/"]') as HTMLInputElement;
    input.value = '/other/path';
    input.dispatchEvent(new Event('input'));

    await new Promise((resolve) => setTimeout(resolve, 200));
    await el.updateComplete;

    // Should show new count
    repositoryCountElement = el.querySelector('#repository-status');
    expect(repositoryCountElement?.textContent).toContain('2 repositories found');
  });

  it('should handle repository discovery errors gracefully', async () => {
    // Mock discovery to fail
    mockRepositoryService.discoverRepositories.mockRejectedValue(new Error('Discovery failed'));

    const el = await fixture<UnifiedSettings>(html`
      <unified-settings .authClient=${mockAuthClient}></unified-settings>
    `);

    el.visible = true;
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 200));
    await el.updateComplete;

    // Should show 0 repositories
    const repositoryCountElement = el.querySelector('#repository-status');
    expect(repositoryCountElement?.textContent).toContain('0 repositories found');
  });

  it('should not trigger discovery if authClient is not available', async () => {
    // Don't initialize mockRepositoryService for this test since no authClient is provided
    const el = await fixture<UnifiedSettings>(html`
      <unified-settings></unified-settings>
    `);

    el.visible = true;
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 200));
    await el.updateComplete;

    // Should still show repository count as 0
    const repositoryCountElement = el.querySelector('#repository-status');
    expect(repositoryCountElement?.textContent).toContain('0 repositories found');
  });
});

describe('UnifiedSettings - Notification Settings', () => {
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

  it('should display notification settings when push notifications are supported', async () => {
    // Mock push notification service as supported
    const { pushNotificationService } = await import('@/client/services/push-notification-service');
    (pushNotificationService.isSupported as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);
    el.visible = true;

    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    // Find the notification section
    const notificationSection = Array.from(el.querySelectorAll('h3')).find((h3) =>
      h3.textContent?.includes('Notifications')
    );
    expect(notificationSection).toBeTruthy();

    // Find the enable notifications toggle
    const enableToggle = el.querySelector('button[aria-checked]');
    expect(enableToggle).toBeTruthy();
  });

  it('should show warning when push notifications are not supported', async () => {
    // Mock push notification service as not supported
    const { pushNotificationService } = await import('@/client/services/push-notification-service');
    (pushNotificationService.isSupported as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);
    el.visible = true;

    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    // Find warning message
    const warningText = Array.from(el.querySelectorAll('p')).find((p) =>
      p.textContent?.includes('Push notifications are not supported')
    );
    expect(warningText).toBeTruthy();
  });

  it('should toggle notifications when enable button is clicked', async () => {
    const { pushNotificationService } = await import('@/client/services/push-notification-service');
    (pushNotificationService.isSupported as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (pushNotificationService.getPermission as ReturnType<typeof vi.fn>).mockReturnValue('granted');
    (pushNotificationService.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue(
      'granted'
    );
    (pushNotificationService.subscribe as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);
    el.visible = true;

    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    // Find and click the enable toggle
    const enableToggle = el.querySelector('button[role="switch"]') as HTMLButtonElement;
    expect(enableToggle).toBeTruthy();

    // Click to enable
    enableToggle.click();

    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    // Verify permission was requested and subscription was created
    expect(pushNotificationService.requestPermission).toHaveBeenCalled();
    expect(pushNotificationService.subscribe).toHaveBeenCalled();
  });

  it('should show notification type toggles when notifications are enabled', async () => {
    const { pushNotificationService } = await import('@/client/services/push-notification-service');
    (pushNotificationService.isSupported as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (pushNotificationService.loadPreferences as ReturnType<typeof vi.fn>).mockReturnValue({
      enabled: true,
      sessionExit: true,
      sessionStart: false,
      sessionError: true,
      commandNotifications: true,
      systemAlerts: true,
      soundEnabled: true,
      vibrationEnabled: true,
    });

    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);
    el.visible = true;

    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    // Find notification type toggles
    const sessionExitToggle = Array.from(el.querySelectorAll('label')).find((label) =>
      label.textContent?.includes('Session Exit')
    );
    const sessionStartToggle = Array.from(el.querySelectorAll('label')).find((label) =>
      label.textContent?.includes('Session Start')
    );
    const commandToggle = Array.from(el.querySelectorAll('label')).find((label) =>
      label.textContent?.includes('Command Completion')
    );

    expect(sessionExitToggle).toBeTruthy();
    expect(sessionStartToggle).toBeTruthy();
    expect(commandToggle).toBeTruthy();
  });

  it('should save preferences when notification type is toggled', async () => {
    const { pushNotificationService } = await import('@/client/services/push-notification-service');
    (pushNotificationService.isSupported as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (pushNotificationService.loadPreferences as ReturnType<typeof vi.fn>).mockReturnValue({
      enabled: true,
      sessionExit: true,
      sessionStart: false,
      sessionError: true,
      commandNotifications: true,
      systemAlerts: true,
      soundEnabled: true,
      vibrationEnabled: true,
    });

    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);
    el.visible = true;

    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    // Find and click a notification type toggle
    const toggleButtons = el.querySelectorAll('button[role="switch"]');
    const sessionExitToggle = Array.from(toggleButtons).find((btn) => {
      const parent = btn.closest('div');
      return parent?.querySelector('label')?.textContent?.includes('Session Exit');
    }) as HTMLButtonElement;

    expect(sessionExitToggle).toBeTruthy();
    sessionExitToggle.click();

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify preferences were saved
    expect(pushNotificationService.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionExit: false, // Toggled from true to false
      })
    );
  });

  it('should send test notification when test button is clicked', async () => {
    const { pushNotificationService } = await import('@/client/services/push-notification-service');
    (pushNotificationService.isSupported as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (pushNotificationService.isSubscribed as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (pushNotificationService.getPermission as ReturnType<typeof vi.fn>).mockReturnValue('granted');
    (pushNotificationService.getSubscription as ReturnType<typeof vi.fn>).mockReturnValue({
      endpoint: 'https://example.com/push',
      expirationTime: null,
    });
    (pushNotificationService.loadPreferences as ReturnType<typeof vi.fn>).mockReturnValue({
      enabled: true,
      sessionExit: true,
      sessionStart: true,
      sessionError: true,
      commandNotifications: true,
      systemAlerts: true,
      soundEnabled: true,
      vibrationEnabled: true,
    });
    (pushNotificationService.testNotification as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);
    el.visible = true;

    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    // Find and click test notification button
    const testButton = Array.from(el.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Test Notification')
    ) as HTMLButtonElement;

    expect(testButton).toBeTruthy();
    expect(testButton.disabled).toBe(false);

    testButton.click();

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify test notification was sent
    expect(pushNotificationService.testNotification).toHaveBeenCalled();
  });

  it('should disable test button when notifications are not subscribed', async () => {
    const { pushNotificationService } = await import('@/client/services/push-notification-service');
    (pushNotificationService.isSupported as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (pushNotificationService.isSubscribed as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (pushNotificationService.getPermission as ReturnType<typeof vi.fn>).mockReturnValue('granted');
    (pushNotificationService.getSubscription as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (pushNotificationService.loadPreferences as ReturnType<typeof vi.fn>).mockReturnValue({
      enabled: true,
      sessionExit: true,
      sessionStart: true,
      sessionError: true,
      commandNotifications: true,
      systemAlerts: true,
      soundEnabled: true,
      vibrationEnabled: true,
    });

    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);
    el.visible = true;

    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    // Find test notification button
    const testButton = Array.from(el.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Test Notification')
    ) as HTMLButtonElement;

    expect(testButton).toBeTruthy();
    expect(testButton.disabled).toBe(true);
    expect(testButton.title).toBe('Enable notifications first');
  });

  it('should handle unsubscribe when disabling notifications', async () => {
    const { pushNotificationService } = await import('@/client/services/push-notification-service');
    (pushNotificationService.isSupported as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (pushNotificationService.isSubscribed as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (pushNotificationService.loadPreferences as ReturnType<typeof vi.fn>).mockReturnValue({
      enabled: true,
      sessionExit: true,
      sessionStart: true,
      sessionError: true,
      commandNotifications: true,
      systemAlerts: true,
      soundEnabled: true,
      vibrationEnabled: true,
    });
    (pushNotificationService.unsubscribe as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);
    el.visible = true;

    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    // Find and click the enable toggle to disable
    const enableToggle = el.querySelector('button[role="switch"]') as HTMLButtonElement;
    enableToggle.click();

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify unsubscribe was called
    expect(pushNotificationService.unsubscribe).toHaveBeenCalled();
    expect(pushNotificationService.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
      })
    );
  });

  it('should show iOS-specific message for Safari', async () => {
    // Mock iOS Safari detection
    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);

    // Override the isIOSSafari method
    // Using object bracket notation to access private methods for testing
    (el as unknown as { isIOSSafari: () => boolean }).isIOSSafari = () => true;
    (el as unknown as { isStandalone: () => boolean }).isStandalone = () => false;

    const { pushNotificationService } = await import('@/client/services/push-notification-service');
    (pushNotificationService.isSupported as ReturnType<typeof vi.fn>).mockReturnValue(false);

    el.visible = true;

    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;

    // Find iOS-specific message
    const iosMessage = Array.from(el.querySelectorAll('p')).find((p) =>
      p.textContent?.includes('Add to Home Screen')
    );
    expect(iosMessage).toBeTruthy();
  });
});
